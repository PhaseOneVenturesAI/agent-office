import { legacyCubby } from './support/legacy-cubby.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import { Drafts } from '../src/server/drafts/index.js';
import { Nodes } from '../src/server/nodes.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { floorHelpers } from '../src/server/office/floors.js';
import { messaging } from '../src/server/office/messaging.js';
import { onConnection } from '../src/server/ws/connection.js';
import { draftsHandlers } from '../src/server/ws/handlers/drafts.js';
import { cubbiesChanged } from '../src/server/ws/handlers/cubbies.js';
import { floorHandlers } from '../src/server/ws/handlers/floors.js';
import { dispatch } from '../src/server/ws/dispatch.js';
import { floorParam } from '../src/server/http/routes/files.js';
import type { Ctx } from '../src/server/office/context.js';

function socket() {
  const events = new Map<string, Function[]>();
  return { readyState: 1, bufferedAmount: 0, sent: [] as any[],
    on(e: string, fn: Function) { events.set(e, [...events.get(e) ?? [], fn]); },
    send(raw: string) { this.sent.push(JSON.parse(raw)); },
    frame(frame: unknown) { for (const fn of events.get('message') ?? []) fn(Buffer.from(JSON.stringify(frame))); },
    close() { this.readyState = 3; for (const fn of events.get('close') ?? []) fn(); },
  };
}
function fixture(t: any, enabled = true, starters: string | undefined = ' Alice, CAROL ') {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-drafts-'));
  const building = new Building(dir, dir);
  const names: Record<string, string> = { alice: 'Alice', bob: 'Bob', carol: 'Carol' };
  const drafts = new Drafts(dir, enabled, starters, id => names[id], building);
  const ctx = { building, drafts, floors: new Map(), clients: new Map(), accounts: { get: (id: string) => names[id] ? { id, name: names[id] } : undefined, seen() {} },
    meOf: (id: string) => ({ admin: id !== 'alice' }),
    goToFloor(c: any, f: any) { c.peer.floor = f.id; },
    toLobby(c: any) { delete c.peer.floor; }, pumpQueues() {},
  } as unknown as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx));
  const nodes = new Nodes(dir, () => ctx.cubbies?.refresh());
  ctx.nodes = nodes;
  ctx.cubbies = new Cubbies(dir, enabled, nodes, id => names[id], id => ctx.floors.has(id), () => cubbiesChanged(ctx), Date.now,
    id => building.list().find(d => d.id === id)?.draft ? drafts.records.rows.get(id)?.owner ?? '' : undefined);
  ctx.openFloor = (def) => {
    const f: any = { id: def.id, def, info: () => ({ id: def.id, name: def.name }), shutdown: async () => {}, arrived() {}, workers: { wakeAll() {} } };
    ctx.floors.set(f.id, f); return f;
  };
  const client = (accountId?: string) => {
    const ws = socket(), c = { id: String(ctx.clients.size), accountId, ws, peer: { id: String(ctx.clients.size), name: accountId ?? 'Alice' } } as any;
    ctx.clients.set(c.id, c); return c;
  };
  t.after(() => { ctx.cancelFloorsChanged(); nodes.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, building, drafts, ctx, nodes, client, names };
}

test('only named accounts create local private drafts; names, collisions, permissions and restart', t => {
  const f = fixture(t);
  for (const owner of [undefined, 'bob', 'missing']) assert.throws(() => f.drafts.create('Secret', owner), /designated/);
  assert.throws(() => f.drafts.create('  ', 'alice'), /name/);
  const c = f.client('alice');
  draftsHandlers['drafts.new'](f.ctx, c, { t: 'drafts.new', name: '  Secret\n project  ' });
  const id = c.ws.sent.find((m: any) => m.t === 'drafts.made').floorId;
  assert.equal(id, 'draft-secret-project');
  assert.equal(c.peer.floor, undefined, 'creation waits for the client to ride');
  floorHandlers['floor.go'](f.ctx, c, { t: 'floor.go', floor: id });
  assert.equal(c.peer.floor, id, 'the owner arrives through the normal visibility check');
  const def = f.building.list()[0]; assert.equal(def.draft, true); assert.equal(def.name, 'Secret project');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: def.dir, encoding: 'utf8' }).trim();
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(git('log', '-1', '--format=%an <%ae>'), 'Agent Office <office@localhost>');
  assert.equal(git('ls-tree', '-r', '--name-only', 'HEAD'), '');
  assert.equal(git('remote'), '');
  assert.equal(statSync(path.join(f.dir, 'drafts.json')).mode & 0o777, 0o600);
  assert.equal(f.drafts.create('Secret project', 'alice').id, id + '-2');
  const building = new Building(f.dir, f.dir), reloaded = new Drafts(f.dir, true, 'alice', x => f.names[x], building);
  assert.equal(building.list()[0].draft, true); assert.equal(reloaded.owns(id, 'alice'), true);
  assert.equal(reloaded.owns(id, 'bob'), false);
});

test('empty starter lists and the off flag have no drafts, including persisted drafts on restart', t => {
  const f = fixture(t), id = f.drafts.create('Secret', 'alice').id;
  for (const starters of [undefined, '', ' , ']) {
    assert.equal(new Drafts(f.dir, true, starters, x => f.names[x], f.building).canStart('alice'), false);
  }
  const disabled = new Drafts(f.dir, false, 'Alice', x => f.names[x], f.building);
  assert.equal(disabled.records.rows.size, 0);
  assert.throws(() => disabled.create('No', 'alice'), /designated/);
  assert.deepEqual(disabled.state(id, 'alice', f.ctx.cubbies), { enabled: false, canStart: false, canKickoff: false });
  f.ctx.drafts = disabled; f.ctx.openFloor(f.building.list()[0]);
  assert.deepEqual(f.ctx.floorInfos({ accountId: 'alice' }), []);
  const off = fixture(t, false); assert.equal(existsSync(path.join(off.dir, 'drafts.json')), false);
});

test('floor lists and throttled updates are per account; other admins cannot ride, remove, or fetch a draft', async t => {
  const f = fixture(t), alice = f.client('alice'), bob = f.client('bob'), guest = f.client();
  const def = f.drafts.create('Hidden project', 'alice'); f.ctx.openFloor(def);
  f.ctx.floorsChanged(); f.ctx.floorsChanged();
  await new Promise(r => setTimeout(r, 300));
  assert.equal(alice.ws.sent.filter((m: any) => m.t === 'floors').length, 1);
  assert.equal(alice.ws.sent[0].floors[0].draft, true);
  for (const c of [bob, guest]) {
    assert.deepEqual(c.ws.sent[0].floors, []);
    assert.equal(f.ctx.arrivalFloor(def.id, c), undefined);
    floorHandlers['floor.go'](f.ctx, c, { t: 'floor.go', floor: def.id });
    floorHandlers['floor.remove'](f.ctx, c, { t: 'floor.remove', floor: def.id });
    assert.ok(c.ws.sent.slice(-2).every((m: any) => m.text === 'No such floor'));
    assert.equal(floorParam(f.ctx, new URL('http://office/api/docs?floor=' + def.id), { account: c.accountId ? { id: c.accountId } : undefined } as any), undefined);
  }
  f.ctx.floorsChanged(); await new Promise(r => setTimeout(r, 300));
  assert.equal(alice.ws.sent.filter((m: any) => m.t === 'floors').length, 1, 'unchanged lists are not sent again');
  const another = f.drafts.create('Another secret', 'alice'); f.ctx.openFloor(another);
  f.ctx.floorsChanged(); await new Promise(r => setTimeout(r, 300));
  assert.equal(bob.ws.sent.filter((m: any) => m.t === 'floors').length, 1, 'private changes do not notify other accounts');
  await f.ctx.closeFloor(f.ctx.floors.get(def.id)!, 'Alice');
  assert.doesNotMatch(JSON.stringify(bob.ws.sent), /Hidden project|draft-hidden/);
});

test('welcome and URL arrival never expose a private floor or another person’s private location', t => {
  const f = fixture(t), def = f.drafts.create('Secret floor', 'alice'); f.ctx.openFloor(def);
  const alice = f.client('alice'); alice.peer.floor = def.id; alice.peer.doing = 'Private design';
  // No floor for Bob: the real connection path builds its empty floor view and welcome.
  const state = () => ({});
  Object.assign(f.ctx, { cfg: {}, chat: { recent: () => [] }, maps: { pick() {}, reload: () => false, state }, team: {}, upgrader: { state },
    ledger: { state }, webhook: { state }, machine: { state }, sky: { state: {} }, themes: { state }, prompts: { state }, leaveOnMerge: { state },
    signins: { state, look: async () => {} }, accountsChanged() {}, limitsOf: () => ({ state: {}, refresh() {} }),
    servicesState: state, deploys: { state }, hygiene: { state }, costwall: { state }, highScores: { top: () => [] }, arcade: { state },
  });
  const ws = socket();
  onConnection(f.ctx, ws as any, new URL('http://office/ws?floor=' + def.id), { account: { id: 'bob', name: 'Bob' } } as any);
  const welcome = ws.sent.find(m => m.t === 'welcome');
  assert.equal(welcome.floor, null); assert.deepEqual(welcome.floors, []);
  assert.equal(welcome.drafts.here, undefined); assert.equal(welcome.peers[0].floor, undefined);
  assert.doesNotMatch(JSON.stringify(ws.sent), /Secret floor|draft-secret|Private design/);
  f.ctx.broadcast({ t: 'peer.update', peer: alice.peer });
  assert.equal(ws.sent.at(-1).peer.floor, undefined);
});

test('one owner cubby supplies private boards and designers, retains boards asleep, and never persists them', t => {
  const f = fixture(t), alice = f.client('alice'), bob = f.client('bob');
  const def = f.drafts.create('Secret', 'alice'); f.ctx.openFloor(def); alice.peer.floor = def.id;
  const setup = legacyCubby(f.ctx.cubbies, def.id, 'alice', 0, 'Nova', {} as any);
  const ws = socket(); f.nodes.attach(ws as any, setup.token);
  ws.frame({ t: 'hello', host: 'private', providers: [] });
  ws.frame({ t: 'cubby.hello', floorId: def.id, computerId: 'computer-alice', computerName: 'Mac mini' });
  const boards = { ideas: [], decisions: ['PRIVATE decision'], plan: ['PRIVATE plan'], screens: [{ id: 'private-screen', title: 'PRIVATE screen', status: 'review', feedback: [] }], brand: { name: 'PRIVATE brand', colors: ['#aabbcc'] } };
  ws.frame({ t: 'cubby.snapshot', floorId: def.id, observedAt: Date.now(), agents: [{ id: 'designer', role: 'builder', tool: 'codex', task: 'Design', branch: '', status: 'working', designer: true }], plan: [], needsYou: [], draft: boards });
  const here = f.drafts.state(def.id, 'alice', f.ctx.cubbies).here!;
  assert.deepEqual(here.boards, boards); assert.equal(here.designers, 1); assert.equal(here.online, true);
  assert.equal(here.leadName, 'Nova'); assert.equal(here.cubbyId, setup.id);
  assert.deepEqual(f.ctx.cubbies.state(def.id, 'bob').cubbies, []);
  assert.equal(f.ctx.cubbies.draftBoards(setup.id, 'bob'), undefined);
  assert.equal(f.drafts.state(def.id, 'bob', f.ctx.cubbies).here, undefined);
  assert.ok(alice.ws.sent.some((m: any) => m.t === 'drafts' && m.state.here?.boards.decisions[0] === 'PRIVATE decision'));
  assert.doesNotMatch(JSON.stringify(bob.ws.sent), /PRIVATE|draft-secret|Nova/);
  for (const file of ['cubbies.json', 'drafts.json', 'floors.json']) assert.doesNotMatch(readFileSync(path.join(f.dir, file), 'utf8'), /PRIVATE/);
  ws.close();
  assert.equal(f.drafts.state(def.id, 'alice', f.ctx.cubbies).here!.online, false);
  assert.deepEqual(f.drafts.state(def.id, 'alice', f.ctx.cubbies).here!.boards, boards);
  for (const type of ['worker.spawn', 'station.prompt', 'queue.add', 'queue.retry', 'queue.limit', 'meeting.start']) {
    dispatch(f.ctx, alice, { t: type } as any);
    assert.match(alice.ws.sent.at(-1).text, /runs on your computer/);
  }
});

test('Building opens a real draft Floor with idle server agents; disabled restarts leave it closed', async t => {
  const f = fixture(t), def = f.drafts.create('Real draft', 'alice');
  Object.assign(f.ctx, { cfg: { dataDir: f.dir, agentCmd: '/usr/bin/false', agentArgs: [] },
    ledger: {}, machine: { room: () => 0 }, prompts: {}, maps: { plan: () => ({}) }, signins: {}, leaveOnMerge: { on: false } });
  const { openFloors } = await import('../src/server/office/floors.js');
  await openFloors(f.ctx, 0);
  const floor = f.ctx.floors.get(def.id)!;
  assert.ok(floor); assert.equal(floor.def.draft, true); assert.equal(floor.project.branch, 'main');
  assert.deepEqual(floor.workers.list(), []); assert.deepEqual(floor.queue.state().tasks, []);
  assert.equal(floor.github.issues.fetchedAt, 0); assert.equal(floor.github.pulls.fetchedAt, 0);
  await floor.shutdown(); f.ctx.floors.clear();
  f.ctx.drafts = new Drafts(f.dir, false, 'Alice', x => f.names[x], f.building);
  await openFloors(f.ctx, 0);
  assert.equal(f.ctx.floors.size, 0);
});


test('removing a public floor chooses only a visible destination, even with a draft first in the building', async t => {
  const f = fixture(t), alice = f.client('alice'), bob = f.client('bob');
  const draft = f.drafts.create('Secret destination', 'alice'); f.ctx.openFloor(draft);
  const publicDef = { ...draft, id: 'public', name: 'Public project', draft: undefined };
  const publicFloor = f.ctx.openFloor(f.building.addLocal({ ...publicDef, dir: path.join(f.dir, 'public') }))!;
  bob.peer.floor = publicFloor.id; alice.peer.floor = draft.id;
  await f.ctx.closeFloor(publicFloor, 'Bob');
  assert.equal(bob.peer.floor, undefined);
  assert.equal(alice.peer.floor, draft.id);
  assert.doesNotMatch(JSON.stringify(bob.ws.sent), /Secret destination|draft-secret/);
});
