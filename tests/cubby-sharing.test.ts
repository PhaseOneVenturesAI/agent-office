import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Cubbies } from '../src/server/cubbies/index.js';
import { Nodes } from '../src/server/nodes.js';
import { TaskQueue } from '../src/server/queue.js';
import { Building } from '../src/server/building.js';
import { Drafts } from '../src/server/drafts/index.js';
import { messaging } from '../src/server/office/messaging.js';
import { floorHelpers } from '../src/server/office/floors.js';
import { navigation } from '../src/server/office/navigation.js';
import { people } from '../src/server/office/people.js';
import { gates } from '../src/server/office/gates.js';
import { onConnection } from '../src/server/ws/connection.js';
import { cubbiesChanged, cubbiesView } from '../src/server/ws/handlers/cubbies.js';
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
function fixture(t: any, enabled = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-sharing-'));
  let now = Date.now();
  const names: Record<string, string> = { alice: 'Alice', bob: 'Bob', admin: 'Admin' };
  const building = new Building(dir, dir);
  const drafts = new Drafts(dir, enabled, 'Alice', id => names[id], building);
  const state = () => ({});
  const ctx = { building, drafts, floors: new Map(), clients: new Map(), cfg: {},
    accounts: { get: (id: string) => names[id] ? { id, name: names[id], role: id === 'admin' ? 'admin' : 'member' } : undefined,
      seen() {}, state, sharedPassword: true },
    chat: { recent: () => [] }, maps: { pick() {}, reload: () => false, state }, team: {}, upgrader: { state },
    ledger: { state }, webhook: { state }, machine: { state }, sky: { state: {} }, themes: { state }, prompts: { state }, leaveOnMerge: { state },
    signins: { state, look: async () => {}, ready: () => true }, limitsOf: () => ({ state: {}, refresh() {} }),
    deliveries: { releaseOwner() {} }, servicesState: state, deploys: { state }, hygiene: { state }, costwall: { state }, highScores: { top: () => [] }, arcade: { state },
  } as unknown as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx), navigation(ctx), people(ctx), gates(ctx));
  const nodes = new Nodes(dir, () => ctx.cubbies?.refresh()); ctx.nodes = nodes;
  ctx.cubbies = new Cubbies(dir, enabled, nodes, id => names[id], id => ctx.floors.has(id), () => cubbiesChanged(ctx), () => now,
    id => ctx.floors.get(id)?.def.draft ? drafts.records.rows.get(id)?.owner ?? '' : undefined);
  const queues: TaskQueue[] = [];
  function open(def: any) {
    const workers = { defaultProvider: 'claude' as const, officeDefault: { provider: 'claude' as const },
      list: () => [], deskOccupied: () => false, spawn: () => { throw Error('Tests must not launch agents'); },
      kill: async () => ({}), fullScreens: () => [], wakeAll() {}, detachAll() {} };
    const data = path.join(dir, 'queue-' + def.id); mkdirSync(data);
    const queue = new TaskQueue(data, workers, false, { update() {}, toast() {}, claimIssue: async () => undefined,
      refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
    queue.setLimit(0); queues.push(queue);
    const floor: any = { id: def.id, def, workers, queue, arrived() {}, info: () => ({ id: def.id, name: def.name }),
      project: { agentProviders: ['claude'] }, github: { issues: state(), pulls: state() }, decor: { list: () => [] },
      plan: { state }, dog: { view: () => null }, court: { state, left: () => false }, garage: { state: () => [], leave: () => false },
      jail: { state }, jukebox: { state }, whiteboard: { scene: () => [] }, meetings: { state }, tv: { state }, changes: { unwatchAll() {} } };
    ctx.floors.set(def.id, floor); return floor;
  }
  const floor = open({ id: 'floor', name: 'Public project' });
  const other = open({ id: 'other', name: 'Other project' });
  function client(accountId?: string, floorId = 'floor', lite = false) {
    const ws = socket();
    onConnection(ctx, ws as any, new URL(`http://office/ws?floor=${floorId}${lite ? '&lite=1' : ''}`),
      { ...(accountId ? { account: { id: accountId, name: names[accountId] } } : {}) } as any);
    const c = ctx.clients.get(ws.sent.find(m => m.t === 'welcome').you)!;
    return { c, ws, send: (msg: unknown) => ws.frame(msg), view: () => cubbiesView(ctx, ctx.floorOf(c), c).cubbies };
  }
  const alice = client('alice'), bob = client('bob'), admin = client('admin');
  function setup(floorId = 'floor') {
    const invite = ctx.cubbies.setup(floorId, 'alice', 0, 'Nova', { skin: 1, hair: 2, style: 3 });
    const ws = socket(); nodes.attach(ws as any, invite.token);
    ws.frame({ t: 'hello', host: 'private-host', providers: [] });
    ws.frame({ t: 'cubby.hello', floorId, computerId: 'private-computer-id', computerName: 'Alice laptop' });
    ws.frame({ t: 'cubby.owner-key', floorId, fingerprint: 'f'.repeat(32) });
    const snapshot = (extra = {}) => ws.frame({ t: 'cubby.snapshot', floorId, observedAt: now,
      agents: [{ id: 'helper', role: 'builder', tool: 'claude', task: 'Private task', branch: 'private', status: 'working' }],
      plan: ['Private plan'], needsYou: ['Private decision'], ...extra });
    snapshot();
    return { ...invite, ws, snapshot };
  }
  const cubby = enabled ? setup() : undefined;
  t.after(() => { nodes.close(); for (const q of queues) q.shutdown(); ctx.cancelFloorsChanged(); rmSync(dir, { recursive: true, force: true }); });
  const knock = (who = bob) => who.send({ t: 'cubbies.knock', id: cubby!.id });
  const admit = (allow = true, who = bob) => alice.send({ t: 'cubbies.admit', id: cubby!.id, accountId: who.c.accountId, allow });
  return { dir, ctx, nodes, drafts, names, floor, other, alice, bob, admin, client, cubby, setup, open, knock, admit,
    advance: (ms: number) => { now += ms; } };
}
const last = (who: { ws: ReturnType<typeof socket> }, type: string) => who.ws.sent.findLast(m => m.t === type);

// Exercise the real socket dispatcher, per-client views, navigation/close hooks and queue.
test('knock and admission share a read-only interior, never owner setup details or write permissions', t => {
  const f = fixture(t), id = f.cubby!.id, ownerElsewhere = f.client('alice', 'other');
  f.knock();
  assert.equal(last(ownerElsewhere, 'cubbies.knocked').id, id);
  assert.deepEqual(last(f.alice, 'cubbies.knocked'), { t: 'cubbies.knocked', id, by: { accountId: 'bob', name: 'Bob' } });
  assert.deepEqual(f.alice.view()[0].knocking, [{ accountId: 'bob', name: 'Bob' }]);
  assert.equal(f.bob.view()[0].interior, undefined);
  f.admit();
  assert.deepEqual(last(f.bob, 'cubbies.answer'), { t: 'cubbies.answer', id, allow: true });
  const watching = last(f.bob, 'cubbies').state.cubbies[0];
  assert.equal(watching.watching, true); assert.equal(watching.mine, false);
  assert.deepEqual(watching.interior.plan, ['Private plan']);
  assert.equal(watching.interior.agents[0].task, 'Private task');
  for (const field of ['watchers', 'knocking']) assert.equal(field in watching, false);
  for (const field of ['computerId', 'ownerFingerprint']) assert.equal(field in watching.interior, false);
  assert.deepEqual(f.alice.view()[0].watchers, [{ accountId: 'bob', name: 'Bob' }]);
  assert.deepEqual(f.alice.view()[0].knocking, []);
  for (const [msg, error] of [
    [{ t: 'cubbies.chat', id, text: 'forged' }, /Only the owner can talk to this lead/],
    [{ t: 'cubbies.setup', slot: 0, leadName: 'Stolen', look: {} }, /already set up/],
    [{ t: 'cubbies.sendTask', id, title: 'No', prompt: 'No' }, /Only the cubby owner/],
    [{ t: 'cubbies.admit', id, accountId: 'admin', allow: true }, /Only the cubby owner/],
  ] as const) { f.bob.send(msg); assert.match(last(f.bob, 'toast').text, error); }
  assert.equal(f.cubby!.ws.sent.length, 1, 'nothing besides cubby.ready crosses to the computer');
  f.alice.send({ t: 'cubbies.chat', id, text: 'Owner says hello', requestId: 'owner-1', at: Date.now(), ownerSig: 'A'.repeat(86) });
  f.cubby!.ws.frame({ t: 'cubby.reply', floorId: 'floor', requestId: 'owner-1', text: 'Lead replies' });
  assert.deepEqual(last(f.bob, 'cubbies').state.cubbies[0].interior.chat.map((m: any) => m.text), ['Owner says hello', 'Lead replies']);
  const saved = readFileSync(path.join(f.dir, 'cubbies.json'), 'utf8');
  assert.doesNotMatch(saved, /watchers|knocking|bob|Owner says hello|Lead replies/);
});

test('owner rejection and sending a watcher out remove the interior immediately', t => {
  const f = fixture(t); f.knock(); f.admit(false);
  assert.equal(last(f.bob, 'cubbies.answer').allow, false); assert.deepEqual(f.alice.view()[0].knocking, []);
  f.advance(30_000); f.knock(); f.admit(); f.admit(false);
  const view = last(f.bob, 'cubbies').state.cubbies[0];
  assert.equal(view.interior, undefined); assert.equal(view.watching, undefined);
  assert.equal(last(f.bob, 'cubbies.answer').allow, false); assert.deepEqual(f.alice.view()[0].watchers, []);
  f.admit(); assert.match(last(f.alice, 'toast').text, /No pending knock/);
});

test('leave, floor exit and browser disconnect release grants; another tab never inherits one', t => {
  const f = fixture(t); f.knock(); f.admit();
  const tab = f.client('bob'); assert.equal(tab.view()[0].interior, undefined);
  f.bob.send({ t: 'cubbies.leave', id: f.cubby!.id }); assert.equal(f.bob.view()[0].interior, undefined);
  f.advance(30_000); f.knock(); f.admit();
  f.ctx.goToFloor(f.bob.c, f.other); assert.deepEqual(f.alice.view()[0].watchers, []);
  f.ctx.goToFloor(f.bob.c, f.floor); assert.equal(f.bob.view()[0].interior, undefined);
  f.advance(30_000); f.knock(); f.admit(); f.bob.ws.close();
  assert.deepEqual(f.alice.view()[0].watchers, []);
  const reconnect = f.client('bob'); assert.equal(reconnect.view()[0].interior, undefined);
  f.knock(reconnect); assert.match(last(reconnect, 'toast').text, /30 seconds/);
});

test('pending knocks disappear on floor exit or disconnect and cannot later be admitted', t => {
  const f = fixture(t); f.knock(); f.ctx.goToFloor(f.bob.c, f.other);
  assert.deepEqual(f.alice.view()[0].knocking, []); f.admit(); assert.match(last(f.alice, 'toast').text, /No pending/);
  f.ctx.goToFloor(f.bob.c, f.floor); f.advance(30_000); f.knock(); f.bob.ws.close();
  assert.deepEqual(f.alice.view()[0].knocking, []);
});

test('lost accounts and sleeping computers revoke watching without restoring it on wake', t => {
  const f = fixture(t); f.knock(); f.admit();
  delete f.names.bob; f.ctx.cubbies.refresh();
  assert.equal(last(f.bob, 'cubbies').state.cubbies[0].interior, undefined);
  f.names.bob = 'Bob'; assert.equal(f.bob.view()[0].interior, undefined);
  f.advance(30_000); f.knock(); f.admit(); f.cubby!.ws.close();
  assert.equal(last(f.bob, 'cubbies').state.cubbies[0].interior, undefined);
  assert.deepEqual(f.alice.view()[0].watchers, []);
  const ws = socket(); f.nodes.attach(ws as any, f.cubby!.token);
  ws.frame({ t: 'hello', providers: [] });
  ws.frame({ t: 'cubby.hello', floorId: 'floor', computerId: 'private-computer-id', computerName: 'Alice laptop' });
  assert.equal(f.bob.view()[0].interior, undefined);
  f.advance(30_000); f.knock(); f.admit(); delete f.names.alice; f.ctx.cubbies.refresh();
  assert.equal(f.bob.view()[0].interior, undefined);
});

test('admin role grants no interior or admission authority; admins must knock and be admitted', t => {
  const f = fixture(t);
  assert.equal(f.admin.c.admin, true); assert.equal(f.admin.view()[0].interior, undefined);
  f.admin.send({ t: 'cubbies.admit', id: f.cubby!.id, accountId: 'admin', allow: true });
  assert.match(last(f.admin, 'toast').text, /Only the cubby owner/);
  f.knock(f.admin); f.admit(true, f.admin); assert.equal(f.admin.view()[0].watching, true);
  assert.equal(f.admin.view()[0].interior!.ownerFingerprint, undefined);
});

test('knocks require a signed-in non-owner on the same floor and an online cubby', t => {
  const f = fixture(t);
  for (const [who, error] of [[f.alice, /already own/], [f.client(), /Sign in/], [f.client('bob', 'other'), /No cubby/]] as const) {
    f.knock(who); assert.match(last(who, 'toast').text, error);
  }
  f.cubby!.ws.close(); f.knock(); assert.match(last(f.bob, 'toast').text, /asleep/);
  assert.deepEqual(f.alice.view()[0].knocking, []);
});

test('knock cooldown is per account and cubby, survives rejection, and expires at 30 seconds', t => {
  const f = fixture(t); f.knock(); f.admit(false);
  const tab = f.client('bob'); f.knock(tab); assert.match(last(tab, 'toast').text, /30 seconds/);
  f.advance(29_999); f.knock(); assert.match(last(f.bob, 'toast').text, /30 seconds/);
  f.advance(1); f.knock(); assert.equal(f.alice.view()[0].knocking!.length, 1);
  f.advance(30_000); f.knock(); assert.match(last(f.bob, 'toast').text, /still waiting/);
  const other = f.setup('other'); f.ctx.goToFloor(tab.c, f.other);
  tab.send({ t: 'cubbies.knock', id: other.id });
  assert.equal(f.ctx.cubbies.state('other', 'alice').cubbies[0].knocking!.length, 1);
});

test('at most eight pending knocks; two-minute expiry removes them and rejects stale admission', t => {
  const f = fixture(t);
  for (let i = 0; i < 9; i++) {
    f.names['knocker' + i] = 'Knocker ' + i;
    const c = f.client('knocker' + i); f.knock(c);
    if (i === 8) assert.match(last(c, 'toast').text, /8 pending/);
  }
  assert.equal(f.alice.view()[0].knocking!.length, 8);
  f.advance(119_999); assert.equal(f.alice.view()[0].knocking!.length, 8);
  f.advance(1); f.ctx.cubbies.refresh(); assert.deepEqual(last(f.alice, 'cubbies').state.cubbies[0].knocking, []);
  f.alice.send({ t: 'cubbies.admit', id: f.cubby!.id, accountId: 'knocker0', allow: true });
  assert.match(last(f.alice, 'toast').text, /No pending/);
  f.knock(); assert.equal(f.alice.view()[0].knocking!.length, 1);
});

test('expiry publishes an update even without a new snapshot or browser request', t => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.knock(); f.advance(120_000); t.mock.timers.tick(120_000);
  assert.deepEqual(last(f.alice, 'cubbies').state.cubbies[0].knocking, []);
});

test('sendTask uses the normal floor queue and owner attribution, only on explicit owner request', t => {
  const f = fixture(t), msg = { t: 'cubbies.sendTask', id: f.cubby!.id, title: ' Review screen ', prompt: 'Review the first screen' };
  f.knock(); f.admit();
  assert.deepEqual(f.floor.queue.state().tasks, []);
  for (const c of [f.bob, f.admin, f.client(), f.client('alice', 'other')]) {
    c.send(msg); assert.deepEqual(f.floor.queue.state().tasks, []); assert.equal(last(c, 'cubbies.taskSent'), undefined);
  }
  f.cubby!.ws.close(); assert.deepEqual(f.floor.queue.state().tasks, [], 'sleep never transfers work');
  f.alice.send(msg);
  const [task] = f.floor.queue.state().tasks;
  assert.equal(task.title, 'Review screen'); assert.equal(task.prompt, msg.prompt);
  assert.equal(task.owner, 'alice'); assert.equal(task.addedBy, 'Alice'); assert.equal(task.status, 'queued');
  assert.deepEqual(last(f.alice, 'cubbies.taskSent'), { t: 'cubbies.taskSent', id: msg.id, title: task.title });
  f.alice.send({ t: 'queue.add', title: 'Normal task', prompt: 'Normal prompt' });
  const normal = f.floor.queue.state().tasks[1];
  for (const field of ['owner', 'addedBy', 'provider', 'status']) assert.equal(task[field], normal[field]);
});

test('sendTask validates lengths and types, and acknowledges only a successful queue insertion', t => {
  const f = fixture(t), msg = { t: 'cubbies.sendTask', id: f.cubby!.id, title: 'Task', prompt: 'Prompt' };
  for (const invalid of [{ title: '' }, { title: '  ' }, { title: 'x'.repeat(121) }, { title: 1 },
    { prompt: 'x'.repeat(4001) }, { prompt: {} }, { prompt: '' }]) {
    f.alice.send({ ...msg, ...invalid }); assert.deepEqual(f.floor.queue.state().tasks, []);
    assert.equal(last(f.alice, 'cubbies.taskSent'), undefined);
  }
  f.alice.send({ ...msg, title: 'x'.repeat(120), prompt: 'p'.repeat(4000) });
  assert.equal(f.floor.queue.state().tasks.length, 1);
  for (let i = 1; i < 100; i++) f.floor.queue.add('prompt', 'Alice', 'title', undefined, undefined, undefined, undefined, 'alice');
  const replies = f.alice.ws.sent.filter(m => m.t === 'cubbies.taskSent').length;
  f.alice.send(msg); assert.match(last(f.alice, 'toast').text, /queue is full/);
  assert.equal(f.alice.ws.sent.filter(m => m.t === 'cubbies.taskSent').length, replies);
});

test('deferred sign-in cannot queue after floor exit or account loss', async t => {
  const f = fixture(t); let ready = false, finish!: () => void;
  Object.assign(f.ctx.signins, { ready: () => ready, look: () => new Promise<void>(resolve => { finish = resolve; }), why: () => 'Sign in first' });
  const msg = { t: 'cubbies.sendTask', id: f.cubby!.id, title: 'Task', prompt: 'Prompt' };
  f.alice.send(msg); finish(); await Promise.resolve();
  assert.equal(last(f.alice, 'cubbies.taskSent'), undefined); assert.deepEqual(f.floor.queue.state().tasks, []);
  f.alice.send(msg); f.ctx.goToFloor(f.alice.c, f.other); ready = true; finish(); await Promise.resolve();
  assert.deepEqual(f.floor.queue.state().tasks, []);
  f.ctx.goToFloor(f.alice.c, f.floor); ready = false; f.alice.send(msg);
  delete f.names.alice; ready = true; finish(); await Promise.resolve();
  assert.deepEqual(f.floor.queue.state().tasks, []); assert.equal(last(f.alice, 'cubbies.taskSent'), undefined);
});

test('lite welcome, floor entry and updates include owner interiors and private drafts', t => {
  const f = fixture(t), lite = f.client('alice', 'floor', true);
  const welcome = last(lite, 'welcome');
  assert.equal(lite.c.peer.lite, true); assert.equal(welcome.cubbies.cubbies[0].interior.leadName, 'Nova');
  assert.deepEqual(welcome.queue, f.floor.queue.state());
  const def = f.drafts.create('Private draft', 'alice'), floor = f.open(def), cubby = f.setup(def.id);
  const boards = { decisions: ['Draft decision'], plan: ['Draft plan'], screens: [], brand: { colors: [] } };
  cubby.snapshot({ draft: boards });
  const phone = f.client('alice', def.id, true), draftWelcome = last(phone, 'welcome');
  assert.equal(draftWelcome.floors.some((v: any) => v.id === def.id), true);
  assert.deepEqual(draftWelcome.drafts.here.boards, boards);
  assert.equal(draftWelcome.cubbies.cubbies[0].interior.leadName, 'Nova');
  f.ctx.goToFloor(lite.c, floor);
  assert.deepEqual(last(lite, 'floor.enter').drafts.here.boards, boards);
  cubby.snapshot({ draft: { ...boards, decisions: ['Changed decision'] } });
  assert.equal(last(phone, 'drafts').state.here.boards.decisions[0], 'Changed decision');
  assert.equal(last(lite, 'cubbies').state.cubbies[0].interior.leadName, 'Nova');
  phone.send({ t: 'cubbies.sendTask', id: cubby.id, title: 'No server work yet', prompt: 'No' });
  assert.match(last(phone, 'toast').text, /Draft work runs on your computer/); assert.deepEqual(floor.queue.state().tasks, []);
  const stranger = f.client('admin', def.id, true);
  assert.equal(last(stranger, 'welcome').floors.some((v: any) => v.id === def.id), false);
  assert.doesNotMatch(JSON.stringify(stranger.ws.sent), /Draft decision|Changed decision|Draft plan|Private draft/);
});

test('sharing and task sending remain disabled with the feature flag off', t => {
  const f = fixture(t, false);
  for (const msg of [{ t: 'cubbies.knock', id: 'missing' }, { t: 'cubbies.admit', id: 'missing', accountId: 'bob', allow: true },
    { t: 'cubbies.sendTask', id: 'missing', title: 'Task', prompt: 'Prompt' }]) f.alice.send(msg);
  assert.deepEqual(f.floor.queue.state().tasks, []);
  assert.equal(last(f.alice, 'cubbies.taskSent'), undefined);
  assert.deepEqual(f.alice.view(), []);
});
