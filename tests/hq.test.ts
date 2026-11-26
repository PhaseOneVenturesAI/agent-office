import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import { HQ } from '../src/server/hq/index.js';
import { hqView, hqPitch, hqChanged, hqImage } from '../src/server/hq/views.js';
import { readProjects } from '../src/server/hq/projects.js';
import { snapshot } from '../src/server/cubbies/snapshot.js';
import { publication } from '../src/server/cubbies/publication.js';
import { cleanProjects } from '../src/shared/protocol/hq.js';
import { Nodes } from '../src/server/nodes.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { Drafts } from '../src/server/drafts/index.js';
import { floorHelpers } from '../src/server/office/floors.js';
import { messaging } from '../src/server/office/messaging.js';
import { dispatch } from '../src/server/ws/dispatch.js';
import { pitchHandlers } from '../src/server/ws/handlers/pitch.js';
import { floorParam } from '../src/server/http/routes/files.js';
import { socket, png, imageFrames } from './support/draft-board.js';
import { cleanImage } from '../src/server/drafts/image-format.js';
import { testOwnerKey } from './support/cubby-keys.js';
import { verifyOwnerVerdict } from '../src/server/cubbies/wire.js';
import type { Ctx } from '../src/server/office/context.js';
const registry = path.join(import.meta.dirname, 'fixtures/hq/projects.json');
const projects = readProjects(registry);
function fixture(t: any, owner: string | undefined = ' ALICE ') {
  const base = path.join(import.meta.dirname, '../.paradev/hq-tests'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'case-')), building = new Building(dir, dir);
  const names: Record<string, string> = { alice: 'Alice', bob: 'Bob', eve: 'Eve' };
  const hq = new HQ(dir, owner, ' bOB , Eddie ', id => names[id], building);
  const ctx = { hq, building, floors: new Map(), clients: new Map(), accounts: { get: (id: string) => names[id] ? { id, name: names[id] } : undefined },
    meOf: () => ({ admin: true }), goToFloor(c: any, f: any) { c.peer.floor = f.id; }, toLobby(c: any) { delete c.peer.floor; }, pumpQueues() {},
    chat: { add() { throw Error('Private chat reached shared history'); } },
  } as unknown as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx));
  const drafts = ctx.drafts = new Drafts(dir, true, 'alice', id => names[id], building);
  const nodes = ctx.nodes = new Nodes(dir, () => {});
  ctx.cubbies = new Cubbies(dir, true, nodes, id => names[id], id => ctx.floors.has(id), () => hqChanged(ctx));
  ctx.openFloor = def => { const f: any = { id: def.id, def, info: () => ({ id: def.id, name: def.name }), shutdown: async () => {} }; ctx.floors.set(f.id, f); return f; };
  for (const d of building.list()) ctx.openFloor(d);
  const client = (accountId: string) => {
    const c: any = { id: String(ctx.clients.size), accountId, ws: socket(), peer: { id: String(ctx.clients.size), name: names[accountId], color: '#ffffff' } };
    ctx.clients.set(c.id, c); return c;
  };
  const normal = building.addLocal({ id: 'normal', dir, name: 'Normal', addedBy: 'Alice', addedAt: 1 }); ctx.openFloor(normal);
  const publish = (floor = 'normal', observedAt = Date.now(), projectList = projects) => {
    if (!ctx.floors.has(floor)) ctx.openFloor(building.addLocal({ id: floor, dir: path.join(dir, floor), name: floor, addedBy: 'Alice', addedAt: 1 }));
    const cb = ctx.cubbies.setup(floor, 'alice', 0, 'Lead', {} as any, '#0f7a6b'), ws = socket();
    nodes.attach(ws as any, cb.token); ws.frame({ t: 'hello', host: 'fixture', providers: [] });
    ws.frame({ t: 'cubby.hello', floorId: floor, computerId: `computer-${floor}`, computerName: 'Mac fixture' });
    ws.frame({ t: 'cubby.snapshot', floorId: floor, observedAt, agents: [], plan: [], needsYou: [], projects: projectList });
    return { cb, ws };
  };
  t.after(() => { ctx.cancelFloorsChanged(); nodes.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ctx, dir, hq, drafts, building, names, client, publish };
}
test('HQ opt-in is idempotent, private after restart, mode 0600 and has no repository', t => {
  const f = fixture(t), d = f.building.list().find(d => f.hq.is(d.id))!;
  assert.equal(d.name, 'HQ'); assert.equal(d.repo, undefined); assert.equal(d.draft, undefined); assert.equal(existsSync(path.join(d.dir, '.git')), false);
  assert.equal(statSync(path.join(f.dir, 'hq.json')).mode & 0o777, 0o600);
  const reloaded = new Building(f.dir, f.dir), hq = new HQ(f.dir, 'Alice', 'Bob', id => f.names[id], reloaded);
  assert.equal(reloaded.list().filter(d => hq.is(d.id)).length, 1);
  const off = new HQ(f.dir, undefined, 'Bob', id => f.names[id], reloaded);
  assert.equal(off.visible(d.id, 'alice'), false); assert.equal(off.visible(d.id, 'bob'), false);
  f.ctx.hq = off; assert.equal(f.ctx.floorInfos({ accountId: 'alice' }).some(f => f.id === d.id), false);
  rmSync(path.join(f.dir, 'hq.json'));
  const lost = new HQ(f.dir, undefined, 'Bob', id => f.names[id], reloaded);
  assert.equal(lost.visible(d.id, 'alice'), false, 'a lost record never publishes HQ');
  new HQ(f.dir, 'Alice', 'Bob', id => f.names[id], reloaded);
  assert.equal(reloaded.list().filter(d => d.name === 'HQ').length, 1);
  const disabled = fixture(t, ''); assert.equal(existsSync(path.join(disabled.dir, 'hq.json')), false);
  assert.equal(disabled.ctx.floorInfos({ accountId: 'eve' }).length, 1);
});
test('owner and managers enter; outsiders cannot list, arrive, enter or fetch HQ; managers cannot remove it', async t => {
  const f = fixture(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve');
  for (const c of [a, b]) {
    assert.ok(f.ctx.floorInfos(c).find(f => f.id === 'hq')?.hq);
    dispatch(f.ctx, c, { t: 'floor.go', floor: 'hq' }); assert.equal(c.peer.floor, 'hq');
  }
  assert.equal(f.ctx.floorInfos(e).some(f => f.id === 'hq'), false);
  assert.equal(f.ctx.arrivalFloor('hq', e)?.id, 'normal');
  dispatch(f.ctx, e, { t: 'floor.go', floor: 'hq' }); assert.equal(e.peer.floor, undefined);
  dispatch(f.ctx, e, { t: 'floor.remove', floor: 'hq' }); assert.equal(e.ws.sent.at(-1).text, 'No such floor');
  assert.equal(floorParam(f.ctx, new URL('http://office/api/docs?floor=hq'), { account: { id: 'eve' } } as any), undefined);
  dispatch(f.ctx, b, { t: 'floor.remove', floor: 'hq' }); await Promise.resolve(); assert.ok(f.ctx.floors.has('hq'));
  for (const c of [a, b]) for (const type of ['worker.spawn', 'station.prompt', 'meeting.start', 'queue.add', 'queue.retry', 'queue.limit', 'queue.remove', 'cubbies.sendTask']) {
    const before = c.ws.sent.length; dispatch(f.ctx, c, { t: type } as any); assert.equal(c.ws.sent.length, before + 1, type); assert.match(c.ws.sent.at(-1).text, /owner’s computer/);
  }
  dispatch(f.ctx, a, { t: 'drafts.kickoff', floorId: 'hq', confirm: 'HQ' }); assert.match(a.ws.sent.at(-1).text, /cannot be kicked off/);
  await assert.rejects(f.drafts.kickoff('hq', 'HQ', 'alice', f.ctx.cubbies), /No such floor/);
  dispatch(f.ctx, a, { t: 'floor.remove', floor: 'hq' }); await new Promise(r => setTimeout(r, 10)); assert.equal(f.ctx.floors.has('hq'), false);
});
test('HQ office chat and positions reach HQ occupants only and never enter shared chat history', t => {
  const f = fixture(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve'), elsewhere = f.client('alice');
  a.peer.floor = b.peer.floor = 'hq'; e.peer.floor = elsewhere.peer.floor = 'normal';
  dispatch(f.ctx, a, { t: 'chat', text: 'Private HQ conversation' });
  for (const c of [a, b]) assert.equal(c.ws.sent.at(-1).name, 'Alice');
  for (const c of [e, elsewhere]) assert.equal(c.ws.sent.length, 0);
  dispatch(f.ctx, a, { t: 'move', x: 7, y: 0, z: 8, rotY: 1, moving: true });
  assert.ok(b.ws.sent.some((m: any) => m.t === 'peer.move')); assert.equal(e.ws.sent.length, 0);
  f.ctx.broadcast({ t: 'peer.update', peer: a.peer });
  assert.equal(e.ws.sent.at(-1).peer.floor, undefined); assert.equal(e.ws.sent.at(-1).peer.x, 0);
});
test('projects reader and snapshot cleaner whitelist types, fields and lengths and preserve the frame cap', () => {
  const before = readFileSync(registry); assert.equal(projects.length, 3); assert.equal(projects[1].name, 'agent-office');
  assert.equal(projects[0].hasMainLead, true); assert.equal(projects[2].hasMainLead, false);
  assert.deepEqual(projects[0].departmentLeads, [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }]);
  assert.doesNotMatch(JSON.stringify(projects), /private|session|app|path/i); assert.deepEqual(readFileSync(registry), before);
  assert.deepEqual(cleanProjects([null, { name: 2 }, { name: 'bad', hasMainLead: 'yes', departmentLeads: [] }]), []);
  const raw = Array(20).fill({ name: 'n'.repeat(100), hasMainLead: true, path: 'SECRET', departmentLeads: Array(20).fill({ department: 'd'.repeat(70), title: 't'.repeat(90), sessionId: 'SECRET' }) });
  const now = Date.now(), s = snapshot({ projects: raw, agents: [], observedAt: now }, now)!;
  assert.equal(s.projects!.length, 12); assert.equal(s.projects![0].name.length, 60); assert.equal(s.projects![0].departmentLeads.length, 8);
  assert.equal(s.projects![0].departmentLeads[0].department.length, 40); assert.equal(s.projects![0].departmentLeads[0].title.length, 60);
  assert.doesNotMatch(JSON.stringify(s), /SECRET/);
  const frame = publication({ ...s, plan: ['x'.repeat(100_000)] }); assert.ok(Buffer.byteLength(JSON.stringify(frame)) <= 64 * 1024); assert.deepEqual(frame.projects, s.projects);
});
test('latest owner projects from any cubby go only to HQ occupants, not watchers or public interiors', t => {
  const f = fixture(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve'), other = f.client('alice');
  a.peer.floor = b.peer.floor = 'hq'; e.peer.floor = other.peer.floor = 'normal';
  assert.deepEqual(hqView(f.ctx, f.ctx.floors.get('hq'), a)?.projects, []);
  const first = f.publish('normal', Date.now() - 1000); f.publish('second', Date.now(), [projects[2]]);
  for (const c of [a, b]) { const view = hqView(f.ctx, f.ctx.floorOf(c), c)!; assert.deepEqual(view.projects, [projects[2]]); assert.equal(view.ownerColor, '#0f7a6b'); }
  assert.equal(hqView(f.ctx, f.ctx.floorOf(other), other), undefined);
  assert.equal(hqView(f.ctx, f.ctx.floors.get('hq'), e), undefined);
  assert.equal(e.ws.sent.some((m: any) => m.t === 'hq'), false); assert.equal(other.ws.sent.some((m: any) => m.t === 'hq'), false);
  assert.doesNotMatch(JSON.stringify(f.ctx.cubbies.state('normal', 'alice')), /Kindly|Marketing/);
  first.ws.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now() + 1, agents: [], plan: [], needsYou: [] });
  assert.deepEqual(hqView(f.ctx, f.ctx.floorOf(a), a)!.projects, []);
});
test('HQ pitch is cross-floor, managers read only, owner verdict remains bound and signed to source cubby', t => {
  const f = fixture(t), a = f.client('alice'), b = f.client('bob'), e = f.client('eve');
  a.peer.floor = b.peer.floor = 'hq'; e.peer.floor = 'normal';
  const { cb, ws } = f.publish(), image = cleanImage(png), key = testOwnerKey();
  const pitch = { department: 'Marketing', lead: 'Lead', version: 'v1', status: 'ready', pieces: [{ id: 'site', kind: 'site', title: 'Pitch', images: [], image: image.meta, notes: [] }] };
  ws.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now(), agents: [], plan: [], needsYou: [], projects, pitch });
  imageFrames('normal', image).forEach(frame => ws.frame(frame));
  assert.equal(hqPitch(f.ctx, a)?.floorId, 'normal'); assert.equal(hqPitch(f.ctx, a)?.displayFloorId, 'hq'); assert.equal(hqPitch(f.ctx, b)?.readOnly, true);
  assert.equal(hqPitch(f.ctx, e), undefined); assert.ok(hqImage(f.ctx, 'bob', cb.id, image.meta.hash)); assert.equal(hqImage(f.ctx, 'eve', cb.id, image.meta.hash), undefined);
  const payload = { cubbyId: cb.id, floorId: 'normal', computerId: 'computer-normal', pieceId: 'site', version: 'v1', verdict: 'approve' as const, requestId: 'verdict', at: Date.now() };
  const message = { ...payload, t: 'pitch.verdict' as const, ownerSig: key.signVerdict(payload) };
  const count = ws.sent.length; pitchHandlers['pitch.verdict'](f.ctx, b, message); assert.equal(ws.sent.length, count);
  pitchHandlers['pitch.verdict'](f.ctx, a, message); assert.equal(ws.sent.at(-1).t, 'cubby.verdict'); assert.equal(ws.sent.at(-1).floorId, 'normal');
  assert.equal(verifyOwnerVerdict(key.ownerKey, ws.sent.at(-1)), true);
  b.peer.floor = 'normal'; assert.equal(hqImage(f.ctx, 'bob', cb.id, image.meta.hash), undefined);
  assert.equal(f.ctx.cubbies.pitchView('normal', 'bob'), undefined);
});
