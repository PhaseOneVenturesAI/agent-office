import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { Pairings, PAIRING_TTL } from '../src/server/link/pairings.js';
import { HQMac } from '../src/server/hq/mac.js';
import { Nodes } from '../src/server/nodes.js';
import { socket } from './support/draft-board.js';
import { linkCommand } from '../src/server/link/cli.js';
import { forgetToken, readToken, saveToken } from '../src/server/link/credentials.js';
import { AccessRequired, accessRefused, backoff, connection, reconnect, request } from '../src/server/link/transport.js';
import { refreshNeeds, NEEDS_COMMAND } from '../src/server/link/needs-refresh.js';
import { linkRoutes } from '../src/server/link/routes.js';
import { requestHandler } from '../src/server/http/router.js';
function home(t: any) {
  mkdirSync('.paradev', { recursive: true }); const dir = mkdtempSync(path.resolve('.paradev/link-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
test('pairing is owner-only, one pending, expires, URL excludes secret, token delivered once', () => {
  let now = 1000, minted = 0; const revoked: string[] = [];
  const p = new Pairings(a => a === 'owner', () => ({ token: `token-${++minted}`, id: `node-${minted}` }), id => { revoked.push(id); }, () => {}, () => now);
  assert.throws(() => p.create('manager', 'mac', 'Mini'), /owner/);
  const a = p.create('owner', 'mac', 'Mini');
  assert.equal(a.approvalPath, `/?link=${a.id}`); assert.ok(!a.approvalPath.includes(a.secret));
  assert.throws(() => p.create('owner', 'other', 'Other'), /already/);
  for (const role of ['manager', 'outsider']) {
    assert.throws(() => p.pending(role), /owner/); assert.throws(() => p.decide(role, a.id, true));
  }
  assert.equal(minted, 0); assert.throws(() => p.poll(a.id, 'wrong'));
  assert.deepEqual(p.poll(a.id, a.secret), { state: 'pending' });
  p.decide('owner', a.id, true); assert.equal(minted, 1);
  assert.deepEqual(p.poll(a.id, a.secret), { state: 'approved', token: 'token-1' });
  assert.throws(() => p.poll(a.id, a.secret));
  const b = p.create('owner', 'mac', 'Mini'); now += PAIRING_TTL;
  assert.throws(() => p.decide('owner', b.id, true)); assert.throws(() => p.poll(b.id, b.secret));
  const c = p.create('owner', 'mac', 'Mini'); p.decide('owner', c.id, false);
  assert.deepEqual(p.poll(c.id, c.secret), { state: 'denied' });
  const d = p.create('owner', 'mac', 'Mini'); p.decide('owner', d.id, true); now += PAIRING_TTL; p.sweep();
  assert.deepEqual(revoked, ['node-2']);
});
test('approved token is bound to owner/computer, persists, owner revoke disconnects and removes snapshots', t => {
  const dir = home(t); let mac: HQMac;
  const nodes = new Nodes(dir, () => mac?.refresh()); t.after(() => nodes.close());
  const hq = { owns: (id?: string) => id === 'owner', is: (id?: string) => id === 'hq', floorId: 'hq' };
  mac = new HQMac(dir, hq, nodes, () => {});
  const p = mac.pairings.create('owner', 'mini-id', 'Mac mini'); mac.pairings.decide('owner', p.id, true);
  const result = mac.pairings.poll(p.id, p.secret); assert.equal(result.state, 'approved');
  const token = result.token!;
  const wrong = socket(); nodes.attach(wrong as any, token); wrong.frame({ t: 'hello' }); wrong.frame({ t: 'hq.hello', computerId: 'wrong', computerName: 'Other' }); assert.equal(wrong.sent.length, 0);
  const ws = socket(); nodes.attach(ws as any, token); ws.frame({ t: 'hello' }); ws.frame({ t: 'hq.hello', computerId: 'mini-id', computerName: 'Mac mini' });
  assert.equal(ws.sent[0].t, 'hq.ready'); assert.equal(mac.status('owner')?.connected, true);
  ws.frame({ t: 'hq.snapshot', computerId: 'mini-id', observedAt: Date.now(), projects: [{ project: { name: 'One', hasMainLead: true, departmentLeads: [] }, agents: [] }] });
  assert.equal(mac.projects('owner')?.length, 1);
  const id = mac.links('owner')[0].id;
  assert.throws(() => mac.revoke('manager', id)); assert.throws(() => mac.links('outsider'));
  const restored = new HQMac(dir, hq, nodes, () => {}); assert.equal(restored.links('owner')[0].computerName, 'Mac mini');
  const waiting = mac.pairings.create('owner', 'second-mini', 'Second mini');
  mac.pairings.decide('owner', waiting.id, true);
  const pendingNode = mac.links('owner').find(n => n.id !== id)!; mac.revoke('owner', pendingNode.id);
  assert.throws(() => mac.pairings.poll(waiting.id, waiting.secret));
  mac.revoke('owner', id); assert.equal(ws.readyState, 3); assert.equal(nodes.known(token), false); assert.equal(mac.projects('owner'), undefined); assert.deepEqual(mac.links('owner'), []);
});
test('--run without token exits 78 and credential files have private modes', async t => {
  const dir = home(t), logs: string[] = [];
  assert.equal(await linkCommand(['https://office.example', '--run'], dir, s => logs.push(s)), 78);
  assert.match(logs.join(''), /run `agent-office link https:\/\/office.example` once to approve this Mac/);
  assert.deepEqual(readdirSync(dir), []);
  const token = 'ao_node_' + 'a'.repeat(48); saveToken(dir, 'https://office.example', token);
  assert.equal(readToken(dir, 'https://office.example'), token); assert.equal(readToken(dir, 'https://other.example'), undefined);
  const folder = path.join(dir, '.agent-office/link'); assert.equal(statSync(folder).mode & 0o777, 0o700);
  for (const f of readdirSync(folder)) assert.equal(statSync(path.join(folder, f)).mode & 0o777, 0o600);
  forgetToken(dir, 'https://office.example', 'another-token'); assert.equal(readToken(dir, 'https://office.example'), token);
  forgetToken(dir, 'https://office.example', token); assert.equal(readToken(dir, 'https://office.example'), undefined);
});
test('reconnect doubles to 30 seconds forever; Access refusals keep retrying every five minutes', async () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => backoff(i)), [1000,2000,4000,8000,16000,30000,30000,30000]);
  for (const status of [301,302,307,308,401,403]) assert.equal(accessRefused(status), true);
  assert.equal(accessRefused(503), false);
  const stop = new AbortController(), waits: number[] = [], logs: string[] = [];
  let calls = 0;
  const code = await reconnect('https://office.example', stop.signal, s => logs.push(s), async () => ({ access: ++calls >= 3 }), async ms => { waits.push(ms); if (waits.length === 6) stop.abort(); });
  assert.equal(code, 0); assert.deepEqual(waits, [1000,2000,300000,300000,300000,300000]);
  assert.match(logs.at(-1)!, /Cloudflare sign-in needed: run `cloudflared access login https:\/\/office.example`/);
});
test('needs refresh executes only the constant local command with no shell, discards output and ignores the exit code', async () => {
  let call: any[] = [];
  await refreshNeeds('/local home', ((...args: any[]) => { call = args; args[3](0); }) as any);
  assert.match(call[0], /(^|\/)python3$/); assert.deepEqual(call[1], ['/local home/Documents/GitHub/AgentHarness/doctor.py']);
  assert.equal(call[2].timeout, 60_000); assert.ok(Object.isFrozen(NEEDS_COMMAND));
  await refreshNeeds('/local', ((...args: any[]) => args[3](1)) as any); // a failed health check still wrote needs.json
  await assert.rejects(refreshNeeds('/local', ((...args: any[]) => args[3](null, Error('secret stderr'))) as any), /^Error: Needs refresh failed$/);
});
test('needs refresh survives a command that prints far more than any buffer', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'needs-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'Documents/GitHub/AgentHarness/doctor.py'); mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, "import sys\nsys.stdout.write('x' * 1_000_000)\nsys.exit(1)\n");
  await refreshNeeds(dir);
});
async function listen(t: any, server: http.Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(r => { server.close(() => r()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
test('real HTTP and websocket refusals never follow redirects or leak credentials', async t => {
  let leaked = 0;
  const receiver = await listen(t, http.createServer((_req,res) => { leaked++; res.end(); }));
  for (const status of [401,403,302]) {
    let seen: http.IncomingMessage | undefined;
    const origin = await listen(t, http.createServer((req,res) => { seen = req; res.writeHead(status, { location: status === 302 ? 'https://team.cloudflareaccess.com/cdn-cgi/access/login/office' : receiver }); res.end(); }));
    await assert.rejects(request(origin, '/api/mac-link/pair', {}, { 'CF-Access-Token': 'test-secret' }), AccessRequired);
    assert.equal(seen?.url, '/api/mac-link/pair');
    const result = await connection(origin, 'node-secret', 'Mac', { 'CF-Access-Token': 'test-secret' }, { disconnected() {} } as any, new AbortController().signal);
    assert.equal(result.access, true); assert.equal(seen?.url, '/ws/node'); assert.equal(seen?.headers.authorization, 'Bearer node-secret');
  }
  assert.equal(leaked, 0);
});
test('HTTP controls enforce owner session and same-origin approval; Access pairing checks owner identity', async t => {
  let mint = 0;
  const pairings = new Pairings(id => id === 'owner', () => ({ token: 'minted-token', id: `node-${++mint}` }), () => {}, () => {});
  const ctx: any = { cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { allowAttempt: () => true, fromRequest: (req: any) => req.headers['x-role'] ? { account: { id: req.headers['x-role'] } } : undefined },
    accounts: { byEmail: (email: string) => ({ id: email === 'owner@example.com' ? 'owner' : 'manager' }) },
    cloudflare: { emailOf: async (req: any) => req.headers['x-email'] },
    hq: { enabled: true, owns: (id: string) => id === 'owner', mac: { pairings, links: () => [], revoke() {} } } };
  const server = http.createServer(requestHandler(ctx, linkRoutes)); const origin = await listen(t, server); ctx.cfg.port = (server.address() as any).port;
  const post = (route: string, body: unknown, headers: Record<string,string> = {}) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/mac-link/pair', { computerId: 'mac', computerName: 'Mini' }, { 'x-email': 'manager@example.com' })).status, 403);
  const p = await (await post('/api/mac-link/pair', { computerId: 'mac', computerName: 'Mini' }, { 'x-email': 'owner@example.com' })).json() as any;
  for (const role of ['manager','outsider']) {
    assert.equal((await fetch(origin + '/api/mac-link', { headers: { 'x-role': role } })).status, 403);
    assert.equal((await post('/api/mac-link', { id: p.id, action: 'approve' }, { 'x-role': role, origin })).status, 403);
  }
  assert.equal((await post('/api/mac-link', { id: p.id, action: 'approve' }, { 'x-role': 'owner', origin: 'https://attacker.example' })).status, 403);
  assert.equal(mint, 0);
  assert.equal((await post('/api/mac-link', { id: p.id, action: 'approve' }, { 'x-role': 'owner', origin })).status, 200);
  const poll = () => post('/api/mac-link/poll', { id: p.id, secret: p.secret });
  assert.deepEqual(await (await poll()).json(), { state: 'approved', token: 'minted-token' }); assert.equal((await poll()).status, 410);
});
