// The department-scoped delegation path, end to end against the real office (see
// docs/department-leads.md): an authenticated lead (its own hook token) delegates through
// POST /office/workers/delegate; the team policy picks the engine; an 'ask' policy holds the job
// for a person's decision; a non-lead agent, a provider in the body and a duplicate title are all
// refused. The fake agent dumps its hook credentials, then sleeps so its pty stays authenticatable.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import type { DepartmentsState, QueueState, ServerMsg, WorkerInfo } from '../src/shared/protocol.js';

type Office = Awaited<ReturnType<typeof startServer>>;
type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

let tmp = '';
let dump = '';
let office: Office;
let base = '';
let hooks = '';
let cookie = '';
const PASSWORD = 'delegate-test';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

class Browser {
  private inbox: ServerMsg[] = [];
  private wake: (() => void) | undefined;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      this.inbox.push(JSON.parse(raw.toString()));
      this.wake?.();
    });
  }
  static open(query = ''): Promise<Browser> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws${query}`, { headers: { cookie, origin: base } });
      const b = new Browser(ws);
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
    });
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  async take<T extends ServerMsg['t']>(t: T, ok: (m: Msg<T>) => boolean = () => true, ms = 15000): Promise<Msg<T>> {
    const until = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && ok(m as Msg<T>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<T>;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`no ${t} within ${ms}ms; got ${this.inbox.map((m) => m.t).join(', ') || 'nothing'}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = undefined;
    }
  }
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const hook = (p: string, body: unknown, token: string) =>
  fetch(hooks + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

/** Reads the hook credentials the fake agent dumped; waits for it to boot. */
async function credentials(workerId: string): Promise<{ token: string }> {
  const file = path.join(dump, `env-${workerId}`);
  const until = Date.now() + 10000;
  for (;;) {
    try {
      const env = readFileSync(file, 'utf8');
      const token = /^AGENT_OFFICE_HOOK_TOKEN=(.+)$/m.exec(env)?.[1];
      if (token) return { token };
    } catch {
      // not yet
    }
    if (Date.now() > until) throw new Error(`no credentials dumped for ${workerId}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-delegate-'));
  dump = path.join(tmp, 'dump');
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  const publicDir = path.join(tmp, 'public');
  const bin = path.join(tmp, 'bin');
  for (const d of [home, project, publicDir, path.join(publicDir, 'assets'), bin, path.join(tmp, 'projects'), dump]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# delegate\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']]) {
    execFileSync('git', args, { cwd: project });
  }
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), `<!doctype html><title>${page}</title>`);
  writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'export {};\n');
  // The stand-in agent: report its hook identity, then stay alive so the hook accepts its token.
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nenv > "$KIMI_DUMP_DIR/env-$AGENT_OFFICE_WORKER_ID" 2>/dev/null\nsleep 30\n');
  chmodSync(claude, 0o755);
  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  process.env.KIMI_DUMP_DIR = dump;
  const port = await freePort();
  const cfg = loadConfig([project, '--home', home, '--projects', path.join(tmp, 'projects'), '--port', String(port), '--password', PASSWORD, '--no-open', '--weather', 'clear', '--agent', claude]);
  office = await startServer(cfg, { publicDir });
  base = `http://127.0.0.1:${port}`;
  hooks = `http://127.0.0.1:${office.hookPort}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
});

after(() => {
  office?.shutdown();
  delete process.env.KIMI_DUMP_DIR;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('the lead delegates over its own hook token: policy engine, parent assignment, ask-mode hold, refusals', async () => {
  const ada = await Browser.open('?name=Ada');
  try {
    // A plain worker is not a lead: delegation is refused with its own token.
    ada.send({ t: 'worker.spawn', deskId: 'desk-1', prompt: 'Just sit there' });
    const plain = (await ada.take('worker.update', (m) => m.worker.deskId === 'desk-1')).worker;
    const plainCreds = await credentials(plain.id);
    const notLead = await hook('/office/workers/delegate?worker=' + plain.id, { title: 'X', task: 'Y' }, plainCreds.token);
    assert.equal(notLead.status, 403);
    assert.match((await notLead.json()).error, /not a department lead/);

    // Name the Marketing lead and start their shift: the seated character takes the lead's name.
    ada.send({ t: 'departments.add', preset: 'marketing' });
    const state = (await ada.take('departments')).state as DepartmentsState;
    const dept = state.departments[0];
    ada.send({ t: 'departments.lead', id: dept.id, name: 'Maya' });
    ada.send({ t: 'departments.lead.launch', id: dept.id });
    const leadUpdate = await ada.take('worker.update', (m) => m.worker.name === 'Maya', 20000);
    const lead = leadUpdate.worker;
    assert.equal(lead.name, 'Maya', 'the visible character carries the lead identity name');
    const leadCreds = await credentials(lead.id);

    // A second shift launch is refused, not duplicated.
    ada.send({ t: 'departments.lead.launch', id: dept.id });
    const dup = await ada.take('toast', (m) => /already on shift/.test(m.text));
    assert.match(dup.text, /Maya is already on shift/);

    // The lead delegates with its own token: queued on the office engine, parent = the lead.
    const ok = await hook('/office/workers/delegate?worker=' + lead.id, { title: 'Hero rewrite', task: 'Redo the hero section' }, leadCreds.token);
    assert.equal(ok.status, 200);
    const queued = (await ok.json()) as { ok: boolean; pending: boolean; task: { id: string } };
    assert.equal(queued.pending, false);
    const queueMsg = await ada.take('queue', (m) => m.state.tasks.some((t) => t.id === queued.task.id), 20000);
    const task = queueMsg.state.tasks.find((t) => t.id === queued.task.id)!;
    assert.equal(task.dept, dept.id);
    assert.equal(task.parentId, lead.id);
    assert.match(task.addedBy, /Maya \(lead\)/);

    // The same live job, reworded department or not, is refused; so is an agent picking an engine.
    const dupe = await hook('/office/workers/delegate?worker=' + lead.id, { title: 'hero rewrite', task: 'Again' }, leadCreds.token);
    assert.equal(dupe.status, 400);
    assert.match((await dupe.json()).error, /already assigned/);
    const engine = await hook('/office/workers/delegate?worker=' + lead.id, { title: 'Footer fix', task: 'Fix it', provider: 'kimi' }, leadCreds.token);
    assert.equal(engine.status, 400);
    assert.match((await engine.json()).error, /policy/);

    // An 'ask' policy holds the delegation for a person; the person rejects it.
    ada.send({ t: 'departments.policy', id: dept.id, provider: 'claude', mode: 'ask' });
    await ada.take('departments', (m) => m.state.departments[0].policy?.mode === 'ask');
    const held = await hook('/office/workers/delegate?worker=' + lead.id, { title: 'Footer fix', task: 'Fix the footer' }, leadCreds.token);
    assert.equal(held.status, 200);
    assert.equal((await held.json()).pending, true);
    const withReq = (await ada.take('departments', (m) => (m.state.departments[0].requests ?? []).length > 0)).state.departments[0];
    const request = withReq.requests![0];
    assert.equal(request.title, 'Footer fix');
    assert.equal(request.by, 'Maya');
    const queueNow = (await ada.take('queue', () => true, 300).catch(() => undefined));
    void queueNow;
    ada.send({ t: 'departments.request.reject', id: dept.id, request: request.id });
    await ada.take('departments', (m) => (m.state.departments[0].requests ?? []).length === 0);
  } finally {
    await ada.close();
  }
});
