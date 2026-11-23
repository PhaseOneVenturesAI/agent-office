// The CEO → manager → worker chain, end to end against the real office (see
// docs/department-leads.md). The fake provider echoes every prompt it receives to an inbox file
// and reports its lifecycle over the claude hook (SessionStart → idle, Stop → done), so the test
// watches the real dispatch: user → CEO (assign + execute) → manager (seated with the objective) →
// manager delegates → worker seated → worker's turn ends → the manager hears it → the CEO hears
// the rollup. No real provider CLI and no GitHub are involved.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync as git } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import type { DepartmentsState, QueueState, ServerMsg } from '../src/shared/protocol.js';

type Office = Awaited<ReturnType<typeof startServer>>;
type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

let tmp = '';
let dump = '';
let office: Office;
let base = '';
let hooks = '';
let cookie = '';
const PASSWORD = 'ceo-chain-test';

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
  static open(): Promise<Browser> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=Ada`, { headers: { cookie, origin: base } });
      const b = new Browser(ws);
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
    });
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  async take<T extends ServerMsg['t']>(t: T, ok: (m: Msg<T>) => boolean = () => true, ms = 25000): Promise<Msg<T>> {
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

const hook = (p: string, body: unknown, token: string) =>
  fetch(hooks + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

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

/** Everything the fake provider was prompted, once it appears; bounded wait. `match` keeps polling until the text shows up. */
async function inbox(workerId: string, match?: RegExp, ms = 25000): Promise<string> {
  const file = path.join(dump, `inbox-${workerId}`);
  const until = Date.now() + ms;
  let text = '';
  for (;;) {
    if (existsSync(file)) {
      text = readFileSync(file, 'utf8');
      if (text.trim() && (!match || match.test(text))) return text;
    }
    if (Date.now() > until) throw new Error(`no inbox lines for ${workerId}${match ? ` matching ${match}` : ''}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-ceo-chain-'));
  dump = path.join(tmp, 'dump');
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  const publicDir = path.join(tmp, 'public');
  const bin = path.join(tmp, 'bin');
  for (const d of [home, project, publicDir, path.join(publicDir, 'assets'), bin, path.join(tmp, 'projects'), dump]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# ceo\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']]) {
    git('git', args, { cwd: project });
  }
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), `<!doctype html><title>${page}</title>`);
  writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'export {};\n');
  // The fake agent: report its hook identity, announce it can take input (SessionStart → idle),
  // echo every prompt to its inbox, and treat management chatter (📣 🎯 📋) as read-and-stay-ready;
  // real task prompts it works and ends its turn (Stop → done), driving the dispatch for real.
  const claude = path.join(bin, 'claude');
  writeFileSync(
    claude,
    `#!/bin/sh
env > "$KIMI_DUMP_DIR/env-$AGENT_OFFICE_WORKER_ID"
last=
for a in "$@"; do printf '%s ' "$a" >> "$KIMI_DUMP_DIR/inbox-$AGENT_OFFICE_WORKER_ID"; last="$a"; done
printf '\\n' >> "$KIMI_DUMP_DIR/inbox-$AGENT_OFFICE_WORKER_ID"
hook() { curl -s -m 3 -X POST "$AGENT_OFFICE_HOOK_URL/hooks/claude?worker=$AGENT_OFFICE_WORKER_ID&event=$1" -H "authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H 'content-type: application/json' -d "$2" >/dev/null 2>&1; }
hook SessionStart '{"session_id":"fake"}'
case "$last" in
  *'📣'*|*'🎯'*|*'📋'*) : ;;
  --|*mcp-config*|*settings*|'') : ;;
  *) hook UserPromptSubmit '{"prompt":"work"}'; sleep 1; hook Stop '{}' ;;
esac
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$KIMI_DUMP_DIR/inbox-$AGENT_OFFICE_WORKER_ID"
  case "$line" in
    *'📣'*|*'🎯'*|*'📋'*) : ;;
    *) hook UserPromptSubmit '{"prompt":"work"}'; sleep 1; hook Stop '{}' ;;
  esac
done
`,
  );
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

test('user → CEO → manager → worker, and results back up the chain', async () => {
  const ada = await Browser.open();
  try {
    // The person names the CEO and starts their shift: a real worker seated under the CEO's name.
    ada.send({ t: 'ceo.set', name: 'Avery' });
    await ada.take('ceo', (m) => m.state.ceo?.name === 'Avery');
    ada.send({ t: 'ceo.launch' });
    const ceoWorker = (await ada.take('worker.update', (m) => m.worker.name === 'Avery')).worker;
    assert.equal(ceoWorker.name, 'Avery', 'the seated character carries the CEO identity name');
    const ceo = await credentials(ceoWorker.id);
    await inbox(ceoWorker.id); // SessionStart + launch prompt arrived

    // A second shift launch is refused, not duplicated.
    ada.send({ t: 'ceo.launch' });
    assert.match((await ada.take('toast', (m) => /already on shift/.test(m.text))).text, /Avery is already on shift/);

    // The marketing department gets a manager (off shift).
    ada.send({ t: 'departments.add', preset: 'marketing' });
    const dept = (await ada.take('departments')).state.departments[0];
    ada.send({ t: 'departments.lead', id: dept.id, name: 'Maya' });

    // Only the CEO may assign; a plain worker is refused.
    ada.send({ t: 'worker.spawn', deskId: 'desk-2', prompt: 'Just sit there' });
    const plain = (await ada.take('worker.update', (m) => m.worker.deskId === 'desk-2' && m.worker.name !== 'Avery')).worker;
    const plainCreds = await credentials(plain.id);
    const notCeo = await hook('/office/workers/assign?worker=' + plain.id, { dept: 'marketing', objective: 'X' }, plainCreds.token);
    assert.equal(notCeo.status, 403);
    assert.match((await notCeo.json()).error, /Only Avery/);

    // An off-shift manager is not started silently: the assignment reports it.
    const held = await hook('/office/workers/assign?worker=' + ceoWorker.id, { dept: 'marketing', objective: 'Ship the homepage hero' }, ceo.token);
    assert.equal(held.status, 400);
    assert.match((await held.json()).error, /off shift/);

    // An 'ask' policy holds the execute for a person rather than picking an engine.
    ada.send({ t: 'departments.policy', id: dept.id, provider: 'claude', mode: 'ask' });
    await ada.take('departments', (m) => m.state.departments[0].policy?.mode === 'ask');
    const asking = await hook('/office/workers/assign?worker=' + ceoWorker.id, { dept: 'marketing', objective: 'Ship the homepage hero', execute: true }, ceo.token);
    assert.equal(asking.status, 400);
    assert.match((await asking.json()).error, /asks each time/);
    ada.send({ t: 'departments.policy', id: dept.id, provider: 'claude', mode: 'policy' });
    await ada.take('departments', (m) => m.state.departments[0].policy?.mode === 'policy');

    // Explicit execute: the manager starts on the supported path, with the objective in context.
    const started = await hook('/office/workers/assign?worker=' + ceoWorker.id, { dept: 'marketing', objective: 'Ship the homepage hero', execute: true }, ceo.token);
    assert.equal(started.status, 200);
    assert.equal((await started.json()).started, true);
    const mgrWorker = (await ada.take('worker.update', (m) => m.worker.name === 'Maya')).worker;
    const mgrCreds = await credentials(mgrWorker.id);
    await inbox(mgrWorker.id, /Ship the homepage hero/);
    const withObjective = (await ada.take('departments', (m) => !!m.state.departments[0].lead?.objective)).state.departments[0];
    assert.match(withObjective.lead!.objective!.text, /Ship the homepage hero/);

    // A second execute does not duplicate the manager; the live one gets the new objective.
    const again = await hook('/office/workers/assign?worker=' + ceoWorker.id, { dept: 'marketing', objective: 'Tighten the message', execute: true }, ceo.token);
    assert.equal((await again.json()).started, false);
    await inbox(mgrWorker.id, /Tighten the message/);

    // A role character is permanent: sending them home is refused, seat and link intact.
    ada.send({ t: 'worker.kill', workerId: mgrWorker.id });
    const stillThere = await fetch(`${hooks}/office/workers?worker=${ceoWorker.id}`, { headers: { authorization: `Bearer ${ceo.token}` } }).then((r) => r.json()) as { workers: { id: string }[] };
    assert.ok(stillThere.workers.some((w) => w.id === mgrWorker.id), 'the manager is not fireable');

    // The manager delegates the actual work; the floor queue seats a worker under her ownership.
    const ok = await hook('/office/workers/delegate?worker=' + mgrWorker.id, { title: 'Hero rebuild', task: 'Rebuild the hero section' }, mgrCreds.token);
    assert.equal(ok.status, 200);
    const taskId = ((await ok.json()) as { task: { id: string } }).task.id;
    const queueMsg = await ada.take('queue', (m) => m.state.tasks.some((t) => t.id === taskId && !!t.workerId));
    const task = queueMsg.state.tasks.find((t) => t.id === taskId)!;
    assert.equal(task.parentId, mgrWorker.id);
    assert.equal(task.dept, dept.id);

    // The worker's turn ends (the fake reports Stop): the manager hears it, and the CEO hears the rollup.
    const childId = task.workerId!;
    const childInbox = await inbox(childId);
    assert.match(childInbox, /Rebuild the hero section/, 'the worker received the delegated task');
    let mgrHeard: string;
    try {
      mgrHeard = await inbox(mgrWorker.id, /ended its turn on “Hero rebuild”/);
    } catch (err) {
      const view = await fetch(`${hooks}/office/workers?worker=${ceoWorker.id}`, { headers: { authorization: `Bearer ${ceo.token}` } }).then((r) => r.json()) as { workers: { id: string; name: string; status: string }[] };
      const q = await ada.take('queue', () => true, 500).catch(() => undefined);
      console.error('DEBUG workers:', JSON.stringify(view.workers.map((w) => [w.name, w.status])));
      console.error('DEBUG queue:', JSON.stringify((q as unknown as { state: { tasks: unknown[] } })?.state?.tasks ?? null));
      console.error('DEBUG mgr inbox:', (await inbox(mgrWorker.id)).slice(-600));
      console.error('DEBUG ceo inbox:', (await inbox(ceoWorker.id)).slice(-400));
      throw err;
    }
    assert.match(mgrHeard, /ended its turn on “Hero rebuild”/, 'the result came back to the manager');
    const ceoHeard = await inbox(ceoWorker.id, /Maya \(Marketing\): .*ended its turn/);
    assert.match(ceoHeard, /Maya \(Marketing\): .*ended its turn on “Hero rebuild”/, 'the result rolled up to the CEO');

    // A blocker goes up too: kill the next job's worker mid-flight…
    const ok2 = await hook('/office/workers/delegate?worker=' + mgrWorker.id, { title: 'Footer polish', task: 'Polish the footer' }, mgrCreds.token);
    const task2Id = ((await ok2.json()) as { task: { id: string } }).task.id;
    const q2 = await ada.take('queue', (m) => m.state.tasks.some((t) => t.id === task2Id && t.workerId));
    const task2 = q2.state.tasks.find((t) => t.id === task2Id)!;
    await inbox(task2.workerId!); // it has its task
    ada.send({ t: 'worker.kill', workerId: task2.workerId });
    const killed = await ada.take('queue', (m) => {
      const t = m.state.tasks.find((x) => x.id === task2Id);
      return !!t && t.status === 'done' && t.outcome === 'killed';
    });
    const killedTask = killed.state.tasks.find((t) => t.id === task2Id)!;
    assert.equal(killedTask.parentId, mgrWorker.id, 'ownership survives the failure');
    await inbox(mgrWorker.id, /sent home mid-job on “Footer polish”/, 25000);
    await inbox(ceoWorker.id, /Maya \(Marketing\): .*sent home mid-job on “Footer polish”/, 25000);

    // …and the retry keeps the same owner: the chain is intact after a failure.
    ada.send({ t: 'queue.retry', taskId: task2Id });
    const q3 = await ada.take('queue', (m) => m.state.tasks.some((t) => t.id === task2Id && t.status === 'running'));
    const task3 = q3.state.tasks.find((t) => t.id === task2Id)!;
    assert.equal(task3.parentId, mgrWorker.id, 'the retried job still reports to the manager');
  } finally {
    await ada.close();
  }
});
