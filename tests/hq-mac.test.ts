import { boundMacSnapshot } from '../src/server/hq/local/bounds.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { configureMac } from '../src/server/hq/local/config.js';
import { macEntries, macSnapshot } from '../src/server/hq/local/snapshot.js';
import { MacConnector } from '../src/server/hq/local/connector.js';
import { HQMac } from '../src/server/hq/mac.js';
import { HQ } from '../src/server/hq/index.js';
import { Nodes } from '../src/server/nodes.js';
import { Building } from '../src/server/building.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { hqProjects, hqSources } from '../src/server/hq/sources.js';
import { hqView, hqPitch, hqImage } from '../src/server/hq/views.js';
import { hqHandlers } from '../src/server/hq/handlers.js';
import { projectLeads } from '../src/server/hq/leads.js';
import { liveProjects } from '../src/server/hq/live.js';
import { socket, png, imageFrames } from './support/draft-board.js';
import { cleanImage } from '../src/server/drafts/image-format.js';
import { MAC_BYTES, macSignature } from '../src/server/hq/wire.js';
import { cubbyKey } from '../src/server/cubbies/wire.js';
import { sendManagerMessage } from '../src/server/hq/messages.js';
import type { Ctx } from '../src/server/office/context.js';
function files(t: any) {
  mkdirSync('.paradev', { recursive: true });
  const home = realpathSync(mkdtempSync(path.resolve('.paradev/hq-mac-test-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const registry = path.join(home, 'Documents/GitHub/AgentHarness/projects.json');
  const runs = path.join(home, 'Library/Application Support/AgentHarness/runs');
  mkdirSync(path.dirname(registry), { recursive: true }); mkdirSync(runs, { recursive: true });
  return { home, registry, runs };
}
const worker = (n: number, lead?: string) => ({ id: `harness:${n}`, tool: 'codex', role: 'builder', task: `Task ${n}`, branch: 'topic', status: 'working', lead, startedAt: n });
const project = (name = 'One') => ({ name, repo: `owner/${name}`, hasMainLead: true, lead: `secret-${name}`, departmentLeads: [{ department: 'Design', title: 'Design lead', lead: `design-${name}` }] });
const pitch = { department: 'Design', lead: 'Design lead', version: 'v1', status: 'ready', pieces: [{ id: 'site', kind: 'site', title: 'Site', notes: [], url: 'https://example.com', images: [] }] };

test('Mac registry projection touches only allowed fields; skips archived, remote-only, missing and accepts null ids', t => {
  const f = files(t), repo = path.join(f.home, 'repo'); mkdirSync(repo);
  const entry: any = { path: repo, url: 'https://user:password@github.com/Owner/Repo.git?secret=1', leadSessionId: null, leadThreadId: null, leadAppSession: 'app-session', departmentLeads: [{ department: 'Design', title: 'Design lead', sessionId: null, appSession: null }] };
  for (const k of ['name', 'lead', 'note', 'historicalLead', 'creativeLineage']) Object.defineProperty(entry, k, { get() { throw Error(`Forbidden read: ${k}`); } });
  Object.defineProperty(entry.departmentLeads[0], 'leadTitle', { get() { throw Error('Forbidden read'); } });
  const rows = macEntries({ projects: { Allowed: entry, Archived: { ...Object.fromEntries(Object.entries(entry)), localState: 'archived' }, Remote: { path: repo, localState: 'remote-only' }, Missing: { path: path.join(f.home, 'missing') } } });
  assert.equal(rows.length, 1); assert.equal(rows[0].project.name, 'Allowed'); assert.equal(rows[0].project.repo, 'Owner/Repo');
  assert.equal(rows[0].project.hasMainLead, true); assert.equal(rows[0].project.lead, undefined);
  assert.deepEqual(rows[0].project.departmentLeads, [{ department: 'Design', title: 'Design lead' }]);
});

test('Mac link all-project snapshot scopes workers to exact worktrees, caps projects/workers, reads needs and pitches', async t => {
  const f = files(t), projects: Record<string, any> = {}, roots = new Map<string, string[]>();
  for (let i = 0; i < 14; i++) {
    const repo = path.join(f.home, `repo${i}`), tree = path.join(f.home, `tree${i}`); mkdirSync(repo); mkdirSync(tree);
    roots.set(repo, [repo, tree]); projects[`Project${i}`] = { path: repo, url: `https://github.com/owner/repo${i}`, leadSessionId: `lead-${i}`, departmentLeads: [] };
    for (let j = 0; j < 8; j++) {
      const pid = 100 + i * 8 + j;
      writeFileSync(path.join(f.runs, `${pid}-abc.json`), JSON.stringify({ schema: 1, pid, folder: tree, provider: 'codex', role: 'builder', lead: `lead-${i}`, title: `Task ${i}/${j}` }));
    }
  }
  projects.Archived = { path: [...roots.keys()][0], localState: 'archived' };
  writeFileSync(f.registry, JSON.stringify({ projects }));
  writeFileSync(path.join(path.dirname(f.runs), 'needs.json'), JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), staleAfterHours: 24, projects: { one: { path: [...roots.values()][0][1], open: 1, items: ['Owner-only line'] } } }));
  const first = [...roots.keys()][0]; mkdirSync(path.join(first, '.agent-office')); writeFileSync(path.join(first, '.agent-office/pitch.json'), JSON.stringify(pitch));
  const before = readFileSync(f.registry), config = configureMac(f.home);
  const frame = await macSnapshot(config, { isAlive: () => true, run: async (_bin, args, cwd) => args[0] === 'rev-parse' ? cwd! : roots.get(cwd!)!.map(r => `worktree ${r}\0branch refs/heads/main\0`).join('') });
  assert.equal(frame.projects.length, 12); assert.equal(frame.projects.reduce((n,p) => n + p.agents.length, 0), 64);
  assert.equal(frame.projects[0].project.needs?.items[0], 'Owner-only line'); assert.equal(frame.projects[0].pitch?.status, 'ready');
  frame.projects.forEach((p,i) => assert.ok(p.agents.every(a => a.lead === `lead-${i}`)));
  assert.doesNotMatch(JSON.stringify(frame), /Documents|folder|repo0\/|tree0/); assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= MAC_BYTES);
  assert.deepEqual(readFileSync(f.registry), before);
});

test('Mac identity is private and stable; token-authenticated readiness survives reconnect', async t => {
  const f = files(t);
  writeFileSync(f.registry, JSON.stringify({ projects: {} }));
  const config = configureMac(f.home);
  assert.equal(statSync(path.join(f.home, '.agent-office/link/computer.json')).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(f.home, '.agent-office/link')).mode & 0o777, 0o700);
  assert.equal(config.computerId, configureMac(f.home).computerId);
  const sent: any[] = [], token = 'local-token', frame = { t: 'hq.snapshot' as const, computerId: config.computerId, observedAt: Date.now(), projects: [] };
  const connector = new MacConnector(config, token, async () => frame); t.after(() => connector.close());
  connector.connected(f => { sent.push(f); }); assert.equal(sent[0].t, 'hq.hello');
  const ready = { t: 'hq.ready' as const, computerId: config.computerId, owner: 'alice', floor: 'hq', connection: 'one' };
  connector.receive(JSON.stringify({ ...ready, signature: '0'.repeat(64) })); await new Promise(r => setTimeout(r, 5)); assert.equal(sent.length, 1);
  connector.receive(JSON.stringify({ ...ready, signature: macSignature(cubbyKey(token), ready) })); await new Promise(r => setTimeout(r, 5)); assert.equal(sent.at(-1).t, 'hq.snapshot');
  connector.disconnected(); connector.connected(f => { sent.push(f); });
  connector.receive(JSON.stringify({ ...ready, connection: 'two', signature: macSignature(cubbyKey(token), { ...ready, connection: 'two' }) }));
  await new Promise(r => setTimeout(r, 5)); assert.equal(sent.filter(f => f.t === 'hq.snapshot').length, 2);
});
function server(t: any) {
  const f = files(t), building = new Building(f.home, f.home);
  const hq = new HQ(f.home, 'Alice', 'Bob', id => ({ name: id === 'alice' ? 'Alice' : id === 'bob' ? 'Bob' : 'Eve' }), building);
  let mac: HQMac;
  const nodes = new Nodes(f.home, () => mac?.refresh()); t.after(() => nodes.close());
  const cubbies = new Cubbies(f.home, true, nodes, id => id, () => true, () => {});
  hq.mac = mac = new HQMac(f.home, hq, nodes, () => {});
  const floor = { id: 'hq', def: {} }, clients = new Map();
  const ctx = { hq, nodes, cubbies, clients, floors: new Map([['hq', floor]]), floorOf: (c: any) => c.floor, accounts: { get: (id: string) => ({ name: id }) },
    sendTo(c: any, f: any) { c.ws.sent.push(f); }, warn(c: any, text: string) { c.ws.sent.push({ t: 'warn', text }); } } as unknown as Ctx;
  const client = (id: string) => { const c = { id, accountId: id, floor, ws: socket() } as any; clients.set(id, c); return c; };
  const connect = (token: string, computerId = 'mac-one') => { const ws = socket(); nodes.attach(ws as any, token); ws.frame({ t: 'hello', host: 'fixture', providers: [] }); ws.frame({ t: 'hq.hello', computerId, computerName: 'Mac mini' }); return ws; };
  return { ...f, ctx, hq, mac, nodes, cubbies, connect, client };
}

test('HQ invitations are owner-only, single pending, re-setup revokes, account/computer binding persists', t => {
  const f = server(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve');
  assert.throws(() => f.mac.setup('bob', 'hq'), /Only/);
  assert.throws(() => f.mac.setup('eve', 'hq'), /Only/);
  const first = f.mac.setup('alice', 'hq').token;
  const next = f.mac.setup('alice', 'hq'); assert.equal(f.nodes.known(first), false); assert.equal(f.nodes.known(next.token), true);
  assert.throws(() => f.mac.setup('alice', 'normal'), /Only/);
  assert.equal(f.nodes.state({ id: 'bob', admin: true }).nodes.length, 0);
  const ws = f.connect(next.token); assert.equal(ws.sent.at(-1).t, 'hq.ready');
  assert.deepEqual(f.mac.status('alice')?.computerName, 'Mac mini'); assert.equal(f.mac.status('alice')?.connected, true);
  const node = f.nodes.state({ id: 'alice' }).nodes[0].id;
  f.mac.accept(node, 'eve', { t: 'hq.snapshot', computerId: 'mac-one', observedAt: Date.now(), projects: [{ project: project(), agents: [] }] });
  assert.equal(f.mac.projects('alice'), undefined);
  const stolen = f.connect(next.token, 'another-mac'); assert.equal(stolen.sent.length, 0);
  const restarted = new HQMac(f.home, f.hq, f.nodes, () => {}); assert.equal(restarted.projects('alice'), undefined);
  assert.equal(statSync(path.join(f.home, 'hq-macs.json')).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(path.join(f.home, 'hq-macs.json'), 'utf8'), /token|secret-|Task|agents/);
});

test('fresh Mac wins, fallback cubbies survives, HQ privacy and all projects, helpers, floor links, pitch and manager notes', t => {
  const f = server(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve');
  const cb = f.cubbies.setup('normal', 'alice', 0, 'Lead', {} as any), cubby = f.connect(cb.token);
  cubby.frame({ t: 'cubby.hello', floorId: 'normal', computerId: 'cubby-computer', computerName: 'Mac cubby' });
  cubby.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now(), agents: [], projects: [project('Fallback')], plan: [], needsYou: [] });
  assert.equal(hqProjects(f.ctx, 'alice')[0].name, 'Fallback');
  const invite = f.mac.setup('alice', 'hq'), ws = f.connect(invite.token);
  const image = cleanImage(png);
  const projects = ['One', 'Two', 'Three'].map((name,i) => ({ project: { ...project(name), needs: { open: 1, items: ['OWNER ONLY'], stale: false, at: new Date().toISOString() } }, agents: [worker(i + 10, `secret-${name}`), worker(i + 20, `design-${name}`)], pitch: { ...pitch, pieces: [{ ...pitch.pieces[0], image: image.meta }] } }));
  ws.frame({ t: 'hq.snapshot', computerId: 'mac-one', observedAt: Date.now(), projects });
  const rows = hqProjects(f.ctx, 'alice'), sources = hqSources(f.ctx, 'alice');
  assert.deepEqual(rows.map(p => p.name), ['One','Two','Three']);
  assert.deepEqual(liveProjects(rows, sources).map(p => p.workers?.length), [2,2,2]);
  const leads = projectLeads(rows, sources, [{ id: 'one-floor', repo: 'OWNER/ONE' }], true);
  assert.equal(leads[0].floorId, 'one-floor'); assert.equal(leads[0].working, 1); assert.equal(leads[1].working, 1);
  const owner = hqView(f.ctx, a.floor, a)!, manager = hqView(f.ctx, b.floor, b)!;
  assert.equal(owner.mac?.connected, true); assert.equal(owner.pitches?.length, 3); assert.equal(manager.mac, undefined);
  assert.equal(owner.projects[0].needs?.items[0], 'OWNER ONLY');
  assert.doesNotMatch(JSON.stringify(manager), /secret-|design-One|mac-one|OWNER ONLY|token|\/Users|sessionId|ownerDevices/);
  assert.equal(hqView(f.ctx, e.floor, e), undefined);
  for (const frame of imageFrames('hq', image)) ws.frame({ ...frame, t: 'hq.image', projectIndex: 2, computerId: 'mac-one' });
  const third = f.mac.pitchViews('alice')[2]; assert.ok(third.pitch.pieces[0].image);
  assert.ok(hqImage(f.ctx, 'bob', third.cubbyId, image.meta.hash)); assert.equal(hqImage(f.ctx, 'eve', third.cubbyId, image.meta.hash), undefined);
  hqHandlers['hq.pitch'](f.ctx, b, { t: 'hq.pitch', projectIndex: 2 }); assert.equal(hqPitch(f.ctx, b)?.cubbyId, third.cubbyId);
  const held = sendManagerMessage(f.ctx, b, leads[0].id, 'Please review'); assert.equal(held.state, 'waiting');
  assert.equal(ws.sent.filter(m => m.t !== 'hq.ready').length, 0, 'no manager message is sent to the Mac');
  assert.doesNotMatch(readFileSync(path.join(f.home, 'hq-macs.json'), 'utf8'), /Task|secret-|OWNER ONLY/);
  ws.close(); assert.equal(hqProjects(f.ctx, 'alice')[0].name, 'Fallback');
});

test('server refuses oversized project and worker snapshots without replacing a good observation', t => {
  const f = server(t), ws = f.connect(f.mac.setup('alice', 'hq').token);
  const publish = (projects: unknown[]) => ws.frame({ t: 'hq.snapshot', computerId: 'mac-one', observedAt: Date.now(), projects });
  publish([{ project: project(), agents: [worker(1)] }]);
  publish(Array.from({ length: 13 }, () => ({ project: project('Bad'), agents: [] })));
  assert.equal(f.mac.projects('alice')![0].name, 'One');
  publish([{ project: project('Bad'), agents: Array.from({ length: 65 }, (_,i) => worker(i)) }]);
  assert.equal(f.mac.projects('alice')![0].name, 'One');
});

test('maximum Unicode metadata stays below the node frame cap without dropping workers or projects', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ project: { name: '界'.repeat(60), repo: `${'r'.repeat(100)}/${'p'.repeat(100)}`, lead: 'm'.repeat(80), hasMainLead: true,
    departmentLeads: Array.from({ length: 8 }, () => ({ department: '界'.repeat(40), title: '界'.repeat(60), lead: 'd'.repeat(80) })),
    needs: { open: 100, at: new Date().toISOString(), stale: false, items: Array(3).fill('界'.repeat(160)) } },
    agents: Array.from({ length: i < 4 ? 6 : 5 }, (_, j) => ({ ...worker(i * 10 + j, 'l'.repeat(80)), id: `harness:${'w'.repeat(115)}${i}-${j}`, task: '界'.repeat(160), branch: '界'.repeat(120), harnessRole: '界'.repeat(60), tool: '界'.repeat(40) })),
    pitch: { ...pitch, pieces: Array.from({ length: 4 }, () => ({ ...pitch.pieces[0], notes: Array(8).fill('界'.repeat(300)) })) } }));
  const frame = boundMacSnapshot({ t: 'hq.snapshot', computerId: 'mac', observedAt: Date.now(), projects: rows as any });
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= MAC_BYTES); assert.equal(frame.projects.length, 12);
  assert.equal(frame.projects.reduce((n,p) => n + p.agents.length, 0), 64);
});

test('freshest of two Macs wins and stale observations fall back; disconnects require a fresh admission', t => {
  const f = server(t), one = f.connect(f.mac.setup('alice', 'hq').token, 'mac-one');
  one.frame({ t: 'hq.snapshot', computerId: 'mac-one', observedAt: Date.now() - 1000, projects: [{ project: project('First'), agents: [] }] });
  const secondInvite = f.mac.setup('alice', 'hq'), two = f.connect(secondInvite.token, 'mac-two');
  two.frame({ t: 'hq.snapshot', computerId: 'mac-two', observedAt: Date.now(), projects: [{ project: project('Second'), agents: [] }] });
  assert.equal(f.mac.projects('alice')![0].name, 'Second');
  two.frame({ t: 'hq.snapshot', computerId: 'mac-two', observedAt: Date.now() - 70_000, projects: [{ project: project('Stale'), agents: [] }] });
  assert.equal(f.mac.projects('alice')![0].name, 'First');
  const replaced = socket(); f.nodes.attach(replaced as any, secondInvite.token); replaced.frame({ t: 'hello', host: 'fixture', providers: [] });
  replaced.frame({ t: 'hq.snapshot', computerId: 'mac-two', observedAt: Date.now(), projects: [{ project: project('Unadmitted'), agents: [] }] });
  assert.equal(f.mac.projects('alice')![0].name, 'First');
});
