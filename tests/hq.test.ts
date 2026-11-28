import { legacyCubby } from './support/legacy-cubby.js';
import { publicProjects } from '../src/shared/protocol/hq.js';
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
import { verifyOwnerVerdict, verifyOwner, ownerFingerprint } from '../src/server/cubbies/wire.js';
import type { Ctx } from '../src/server/office/context.js';
const registry = path.join(import.meta.dirname, 'fixtures/hq/projects.json');
const projects = readProjects(registry);
function fixture(t: any, owner: string | undefined = ' ALICE ') {
  const base = path.join(import.meta.dirname, '../.paradev/hq-tests'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'case-')), building = new Building(dir, dir);
  const names: Record<string, string> = { alice: 'Alice', bob: 'Bob', eve: 'Eve' };
  const acct = (id: string) => names[id] ? { name: names[id], email: `${id}@example.test` } : undefined;
  const hq = new HQ(dir, owner, ' bOB , Eddie ', acct, building);
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
    const cb = legacyCubby(ctx.cubbies, floor, 'alice', 0, 'Lead', {} as any, '#0f7a6b'), ws = socket();
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
  const reloaded = new Building(f.dir, f.dir), hq = new HQ(f.dir, 'Alice', 'Bob', id => f.names[id] ? { name: f.names[id] } : undefined, reloaded);
  assert.equal(reloaded.list().filter(d => hq.is(d.id)).length, 1);
  const off = new HQ(f.dir, undefined, 'Bob', id => f.names[id] ? { name: f.names[id] } : undefined, reloaded);
  assert.equal(off.visible(d.id, 'alice'), false); assert.equal(off.visible(d.id, 'bob'), false);
  f.ctx.hq = off; assert.equal(f.ctx.floorInfos({ accountId: 'alice' }).some(f => f.id === d.id), false);
  rmSync(path.join(f.dir, 'hq.json'));
  const lost = new HQ(f.dir, undefined, 'Bob', id => f.names[id] ? { name: f.names[id] } : undefined, reloaded);
  assert.equal(lost.visible(d.id, 'alice'), false, 'a lost record never publishes HQ');
  new HQ(f.dir, 'Alice', 'Bob', id => f.names[id] ? { name: f.names[id] } : undefined, reloaded);
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
  assert.deepEqual(publicProjects(projects, true)[0].departmentLeads, [{ department: 'Marketing', title: 'Marketing lead' }, { department: 'Design', title: 'Design lead' }]);
  assert.doesNotMatch(JSON.stringify(publicProjects(projects, true)), /private|session|app|path/i); assert.deepEqual(readFileSync(registry), before);
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

test('HQ owner and managers can be named by Cloudflare email, which survives a renamed account', t => {
  const f = fixture(t), building = new Building(f.dir, f.dir);
  const accounts: Record<string, { name: string; email?: string }> = { a: { name: 'Jonathan 2', email: 'boss@example.test' }, m: { name: 'Ivanh', email: 'ivanh@example.test' }, x: { name: 'Ivanh' } };
  const hq = new HQ(f.dir, 'Boss@Example.test', 'IVANH@example.test, Eduardo@example.test', id => accounts[id], building);
  const id = building.list().find(d => hq.is(d.id))!.id;
  assert.equal(hq.owns('a'), true); assert.equal(hq.visible(id, 'm'), true);
  assert.equal(hq.visible(id, 'x'), false, 'an account that only shares the name is not let in');
  assert.equal(hq.ownerName, 'Boss', 'an email owner shows by its name, not the address');
  const named = new HQ(f.dir, 'Boss@Example.test', '', id => accounts[id], building, e => Object.values(accounts).find(a => a.email === e.toLowerCase()));
  assert.equal(named.ownerName, 'Jonathan 2', 'an email owner shows by the office name of the account it signs in as');
});

test('HQ project links use the own snapshot floor, otherwise exact repo names; never guess by display name', async t => {
  const { projectFloor, projectLeads } = await import('../src/server/hq/leads.js');
  const { githubRepo } = await import('../src/server/hq/projects.js');
  const p = { name: 'Plimbo', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead' }] };
  const floors = [{ id: 'local' }, { id: 'repo', repo: 'Owner/Plimbo' }, { id: 'Plimbo' }];
  assert.equal(projectFloor({ ...p, own: true, repo: 'owner/plimbo' }, 'local', floors), 'local');
  assert.equal(projectFloor({ ...p, repo: 'owner/plimbo' }, undefined, floors), 'repo');
  assert.equal(projectFloor(p, 'local', floors), undefined);
  assert.equal(projectFloor({ ...p, repo: 'other/plimbo' }, undefined, floors), undefined);
  assert.equal(githubRepo('https://user:secret@github.com/owner/plimbo.git?token=secret#secret'), 'owner/plimbo');
  for (const raw of ['https://evil.test/owner/plimbo', 'https://github.com/owner/plimbo/tree/main', 'file:///owner/plimbo', null]) assert.equal(githubRepo(raw), undefined);
  const own = readProjects(registry, { project: '/missing', roots: [] });
  assert.ok(own.every(p => !p.own));
  const raw = JSON.parse(readFileSync(registry, 'utf8')).projects;
  const entry = Object.values(raw).find((p: any) => p.path) as any;
  if (entry) assert.equal(readProjects(registry, { project: entry.path, roots: [] }).filter(p => p.own).length, 1);
  const clean = cleanProjects([{ ...p, own: 'true', repo: 'https://github.com/o/r', path: '/secret' }, { ...p, own: true, repo: 'o/r' }, { ...p, own: true }]);
  assert.equal(clean[0].own, undefined); assert.equal(clean[0].repo, undefined); assert.equal(clean[1].own, true); assert.equal(clean[2].own, undefined);
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  const snap = snapshot({ t: 'cubby.snapshot', floorId: 'local', observedAt: Date.now(), agents: [], projects: [{ ...p, own: true, repo: 'o/r' }] }, Date.now())!;
  assert.equal(snap.projects![0].own, true); assert.equal(snap.projects![0].repo, 'o/r');
  const f = fixture(t), { cb, ws } = f.publish('normal', Date.now(), [{ ...p, own: true }]);
  const a = f.client('alice'); a.peer.floor = 'hq';
  const leads = hqView(f.ctx, f.ctx.floorOf(a), a)!.leads!;
  assert.equal(leads[0].floorId, 'normal'); assert.equal(leads[0].cubby?.id, cb.id); assert.equal(leads[0].where, 'hq'); assert.equal(leads[1].cubby, undefined);
  const pitch: any = { department: 'Marketing', lead: 'Marketing lead', status: 'ready', version: 'v1', pieces: [{ id: 'site', kind: 'site', title: 'Page', notes: [], images: [] }] };
  ws.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now(), agents: [], plan: [], needsYou: ['Review'], projects: [{ ...p, own: true }], pitch });
  const pending = hqView(f.ctx, f.ctx.floorOf(a), a)!.leads!;
  assert.equal(pending[0].where, 'hq'); assert.equal(pending[1].where, 'hq'); assert.equal(pending[0].needsYou, true);
  const stamped = { ...pitch, pieces: pitch.pieces.map((p: any) => ({ ...p, stamp: { requestId: 'verdict', verdict: 'approve', at: Date.now() } })) };
  ws.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now(), agents: [], plan: [], needsYou: [], projects: [{ ...p, own: true }], pitch: stamped });
  assert.equal(hqView(f.ctx, f.ctx.floorOf(a), a)!.leads![0].where, 'hq');
  const sources = f.ctx.cubbies.hqSources('alice');
  const reordered = projectLeads([{ name: 'Other', hasMainLead: true, departmentLeads: [] }, { ...p, own: true }], sources, [{ id: 'normal' }], true);
  assert.equal(reordered.find(l => l.cubby)?.id, leads[0].id, 'conversation identity survives registry reordering');
  assert.equal(projectLeads([{ ...p, own: true }, { ...p, repo: 'o/r' }], sources, [{ id: 'normal', repo: 'o/r' }], true).filter(l => l.cubby).length, 1);
});

test('HQ lead chat preserves source signatures; managers read but cannot send; other cubbies and outsiders stay unchanged', async t => {
  const { cubbiesView } = await import('../src/server/ws/handlers/cubbies.js');
  const { hqChat } = await import('../src/server/hq/leads.js');
  const f = fixture(t), { cb, ws } = f.publish('normal', Date.now(), [{ name: 'Plimbo', own: true, hasMainLead: true, departmentLeads: [] }]);
  const a = f.client('alice'), m = f.client('bob'), e = f.client('eve');
  a.peer.floor = m.peer.floor = 'hq'; e.peer.floor = 'normal';
  const owner = testOwnerKey();
  ws.frame({ t: 'cubby.devices', floorId: 'normal', devices: [{ fingerprint: ownerFingerprint(owner.ownerKey), label: 'Owner', addedAt: Date.now() }], requests: [] });
  const manager = hqView(f.ctx, f.ctx.floorOf(m), m)!.leads![0].cubby!;
  assert.equal(manager.mine, false); assert.equal(manager.watching, true); assert.ok(manager.interior); assert.equal(manager.interior.ownerDevices, undefined); assert.equal(manager.interior.computerId, undefined);
  const payload = { cubbyId: cb.id, floorId: 'normal', computerId: 'computer-normal', requestId: 'message', at: Date.now(), text: 'Same lead' };
  const message = { id: cb.id, ...payload, ownerSig: owner.sign(payload) };
  assert.throws(() => hqChat(f.ctx, m, message), /Only the cubby owner/);
  assert.throws(() => hqChat(f.ctx, e, message), /Only the cubby owner/);
  hqChat(f.ctx, a, message);
  assert.equal(ws.sent.at(-1).t, 'cubby.chat'); assert.equal(ws.sent.at(-1).floorId, 'normal'); assert.equal(ws.sent.at(-1).ownerSig, message.ownerSig);
  assert.equal(verifyOwner(owner.ownerKey, ws.sent.at(-1)), true);
  assert.equal(verifyOwner(owner.ownerKey, { ...ws.sent.at(-1), floorId: 'hq' }), false);
  a.peer.floor = m.peer.floor = 'normal';
  const mine = cubbiesView(f.ctx, f.ctx.floorOf(a), a)!;
  assert.equal(mine.cubbies[0].hqLead?.lead.where, 'hq');
  const watched = cubbiesView(f.ctx, f.ctx.floorOf(m), m)!.cubbies[0];
  assert.equal(watched.hqLead, undefined); assert.equal(watched.interior, undefined); assert.equal(watched.watching, undefined, 'HQ does not admit managers to cubby interiors');
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(e), e)!.cubbies[0].hqLead, undefined);
  legacyCubby(f.ctx.cubbies, 'normal', 'bob', 1, 'Other lead', {} as any);
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(a), a)!.cubbies[1].hqLead, undefined);
  f.ctx.hq = new HQ(f.dir, '', '', () => undefined, f.building);
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(a), a)!.cubbies[0].hqLead, undefined);
});

test('portfolio overflow never removes a cubby body without a furnished HQ desk', async t => {
  const { cubbiesView } = await import('../src/server/ws/handlers/cubbies.js');
  const f = fixture(t);
  f.publish('normal', Date.now(), Array.from({ length: 8 }, (_, i) => ({ name: `Project ${i}`, hasMainLead: true, departmentLeads: [], ...(i === 7 ? { own: true as const } : {}) })));
  const a = f.client('alice'); a.peer.floor = 'hq';
  const hq = hqView(f.ctx, f.ctx.floorOf(a), a)!;
  assert.equal(hq.projects.length, 8); assert.equal(hq.leads!.length, 6);
  a.peer.floor = 'normal';
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(a), a)!.cubbies[0].hqLead, undefined);
});

test('held manager messages are private; only a trusted owner signature passes the exact labelled chat to the connector', async t => {
  const { sendManagerMessage, declineManagerMessage, passManagerMessage, messages } = await import('../src/server/hq/messages.js');
  const { managerMessageText } = await import('../src/shared/protocol/hq.js');
  const { cubbiesView } = await import('../src/server/ws/handlers/cubbies.js');
  const f = fixture(t), { cb, ws } = f.publish('normal', Date.now(), [{ name: 'Plimbo', own: true, hasMainLead: true, departmentLeads: [] }]);
  f.names.eddie = 'Eddie';
  const a = f.client('alice'), m = f.client('bob'), other = f.client('eddie'), e = f.client('eve');
  a.peer.floor = m.peer.floor = other.peer.floor = e.peer.floor = 'hq';
  const lead = hqView(f.ctx, f.ctx.floorOf(a), a)!.leads![0];
  const visible = (c: any) => hqView(f.ctx, f.ctx.floorOf(c), c)?.leads?.[0].messages;
  const before = ws.sent.length;
  const item = sendManagerMessage(f.ctx, m, lead.id, '  Please review this idea.  ');
  assert.equal(item.text, 'Please review this idea.'); assert.equal(ws.sent.length, before, 'held send reaches no connector');
  for (const c of [a, m]) assert.equal(visible(c)?.[0].state, 'waiting');
  assert.deepEqual(visible(other), []); assert.equal(visible(e), undefined);
  assert.equal(JSON.stringify(visible(m)).includes('managerId'), false);
  for (const c of [m, other, e]) assert.throws(() => declineManagerMessage(f.ctx, c, item.id));
  for (const c of [a, e]) assert.throws(() => sendManagerMessage(f.ctx, c, lead.id, 'No'));
  assert.throws(() => sendManagerMessage(f.ctx, m, 'unrelated-lead', 'No'), /connected/);
  assert.throws(() => sendManagerMessage(f.ctx, m, lead.id, 'Too soon'), /30 seconds/);
  a.peer.floor = m.peer.floor = 'normal';
  assert.match(cubbiesView(f.ctx, f.ctx.floorOf(a), a)!.cubbies[0].hqLead!.lead.messageBadge!, /1 message from Bob/);
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(a), a)!.cubbies[0].hqLead!.lead.messages, undefined);
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(m), m)!.cubbies[0].hqLead, undefined);
  assert.throws(() => sendManagerMessage(f.ctx, m, lead.id, 'Wrong floor'), /HQ only/);
  assert.throws(() => declineManagerMessage(f.ctx, a, item.id), /HQ only/);
  a.peer.floor = m.peer.floor = 'hq';
  const owner = testOwnerKey(), attacker = testOwnerKey();
  ws.frame({ t: 'cubby.devices', floorId: 'normal', devices: [{ fingerprint: ownerFingerprint(owner.ownerKey), label: 'Owner', addedAt: Date.now() }], requests: [] });
  const payload = { cubbyId: cb.id, floorId: 'normal', computerId: 'computer-normal', requestId: item.id, at: Date.now(), text: managerMessageText(item) };
  const pass = { t: 'cubbies.chat' as const, id: cb.id, ...payload, hqMessageId: item.id, ownerPublicKey: owner.ownerKey, ownerSig: owner.sign(payload) };
  const count = ws.sent.length;
  for (const c of [m, other, e]) assert.throws(() => passManagerMessage(f.ctx, c, pass));
  for (const forged of [
    { ...pass, ownerSig: 'A'.repeat(86) },
    { ...pass, ownerSig: attacker.sign(payload), ownerPublicKey: attacker.ownerKey },
    { ...pass, text: 'Unlabelled text' },
    { ...pass, ownerSig: owner.sign({ ...payload, floorId: 'hq' }) },
    { ...pass, requestId: 'different-id' },
  ]) assert.throws(() => passManagerMessage(f.ctx, a, forged), /trusted device/);
  assert.equal(ws.sent.length, count); assert.equal(visible(a)?.[0].state, 'waiting');
  dispatch(f.ctx, a, pass);
  const delivered = ws.sent.at(-1);
  assert.equal(delivered.t, 'cubby.chat'); assert.equal(delivered.text, "Message from Bob (HQ manager; can't approve merges, publishes or spending): Please review this idea.");
  assert.equal(delivered.ownerSig, pass.ownerSig); assert.equal(verifyOwner(owner.ownerKey, delivered), true, 'connector verifier accepts the full labelled text');
  assert.equal(delivered.hqMessageId, undefined); assert.equal(delivered.ownerPublicKey, undefined);
  for (const c of [a, m, other]) assert.equal(visible(c)?.[0].state, 'passed');
  assert.throws(() => passManagerMessage(f.ctx, a, pass), /No waiting/);
  ws.frame({ t: 'cubby.reply', floorId: 'normal', requestId: item.id, text: 'I will review the idea.' });
  assert.equal(hqView(f.ctx, f.ctx.floorOf(m), m)!.leads![0].cubby!.interior!.chat.at(-1)!.text, 'I will review the idea.');
  const declined = sendManagerMessage(f.ctx, other, lead.id, 'Another idea');
  const prior = ws.sent.length;
  declineManagerMessage(f.ctx, a, declined.id);
  assert.equal(ws.sent.length, prior); assert.equal(visible(other)?.find(i => i.id === declined.id)?.state, 'declined');
  assert.equal(visible(m)?.some(i => i.id === declined.id), false);
  assert.throws(() => messages(f.ctx).waiting(declined.id, 'alice'), /No waiting/);
  assert.equal(e.ws.sent.some((frame: any) => frame.t === 'hq'), false);
});

test('held queue trims and caps text, caps five waiting per manager, expires after 24 hours and discards old memory', async () => {
  const { HQMessages, MESSAGE_TTL } = await import('../src/server/hq/messages.js');
  let now = 1000;
  const queue = new HQMessages(() => now);
  const first = queue.send('owner', 'bob', 'Bob', 'lead', `  ${'a'.repeat(5000)}  `);
  assert.equal(first.text.length, 4000);
  assert.throws(() => queue.send('owner', 'bob', 'Bob', 'lead', 'next'), /30 seconds/);
  for (let i = 0; i < 4; i++) { now += 30_000; queue.send('owner', 'bob', 'Bob', 'lead', 'next'); }
  now += 30_000;
  assert.throws(() => queue.send('owner', 'bob', 'Bob', 'other-lead', 'six'), /5 waiting/);
  assert.throws(() => queue.send('owner', 'eve', 'Eve', 'lead', ' \n '), /Write/);
  assert.deepEqual(queue.visible('owner', 'other', 'lead'), []);
  assert.deepEqual(queue.visible('another-owner', 'bob', 'lead'), []);
  now = first.at + MESSAGE_TTL;
  assert.equal(queue.visible('owner', 'bob', 'lead')[0].state, 'expired');
  assert.throws(() => queue.waiting(first.id, 'owner'), /No waiting/);
  assert.doesNotThrow(() => queue.send('owner', 'bob', 'Bob', 'lead', 'room again'));
  now += 2 * MESSAGE_TTL;
  assert.deepEqual(queue.visible('owner', 'owner', 'lead'), []);
});

test('HQ live projections hide lines and matching IDs from managers/outsiders; existing merge emission rings HQ exactly once', async t => {
  const { hqFloorEmit } = await import('../src/server/hq/gong.js');
  const { cubbiesView } = await import('../src/server/ws/handlers/cubbies.js');
  const f = fixture(t), p = { name: 'Live project', own: true as const, hasMainLead: true, lead: 'private-session', departmentLeads: [],
    needs: { open: 2, items: ['SECRET_NEEDS'], stale: true, at: new Date().toISOString() } };
  const { ws } = f.publish('normal', Date.now(), [p]);
  const a = f.client('alice'), m = f.client('bob'), e = f.client('eve'), elsewhere = f.client('alice');
  a.peer.floor = m.peer.floor = e.peer.floor = 'hq'; elsewhere.peer.floor = 'normal';
  ws.frame({ t: 'cubby.snapshot', floorId: 'normal', observedAt: Date.now(), agents: [{ id: 'harness:123', tool: 'codex', role: 'builder', status: 'working', task: 'HQ live', branch: 'main', lead: 'private-session', startedAt: 1 }], plan: [], needsYou: [], projects: [p] });
  const owner = hqView(f.ctx, f.ctx.floorOf(a), a)!;
  assert.equal(owner.projects[0].workers?.[0].title, 'HQ live'); assert.equal(owner.leads?.[0].where, 'hq'); assert.equal(owner.leads?.[0].needs?.items[0], 'SECRET_NEEDS');
  assert.doesNotMatch(JSON.stringify(owner), /private-session/);
  const manager = hqView(f.ctx, f.ctx.floorOf(m), m)!;
  assert.equal(manager.projects[0].needs?.open, 2); assert.doesNotMatch(JSON.stringify(manager), /SECRET_NEEDS|private-session/);
  assert.equal(hqView(f.ctx, f.ctx.floors.get('hq'), e), undefined);
  e.peer.floor = m.peer.floor = 'normal';
  assert.doesNotMatch(JSON.stringify(cubbiesView(f.ctx, f.ctx.floorOf(e), e)), /SECRET_NEEDS|private-session|hqLead|HQ live/);
  assert.doesNotMatch(JSON.stringify(cubbiesView(f.ctx, f.ctx.floorOf(m), m)), /SECRET_NEEDS|private-session/);
  assert.equal(cubbiesView(f.ctx, f.ctx.floorOf(elsewhere), elsewhere)?.cubbies[0].hqLead?.lead.needs?.open, 2);
  m.peer.floor = 'hq';
  const emit = hqFloorEmit(f.ctx), floor = f.ctx.floors.get('normal')!;
  emit(floor, { t: 'gong', why: 'merged', pr: 17, by: 'Owner' }); emit(floor, { t: 'gong', why: 'merged', pr: 17, by: 'Owner' });
  for (const c of [a, m]) assert.deepEqual(c.ws.sent.filter((m: any) => m.t === 'hq.gong'), [{ t: 'hq.gong', project: 'Live project', pr: 17 }]);
  for (const c of [e, elsewhere]) assert.equal(c.ws.sent.some((m: any) => m.t === 'hq.gong'), false);
  emit(floor, { t: 'gong', why: 'hit', by: 'Owner' });
  assert.equal(a.ws.sent.filter((m: any) => m.t === 'hq.gong').length, 1);
});

test('legacy sharing grants cannot expose HQ owner threads on projects; retired setup is inert', async t => {
  const { cubbiesView, cubbiesHandlers } = await import('../src/server/ws/handlers/cubbies.js');
  const f = fixture(t), { cb } = f.publish('normal', Date.now(), [{ name: 'Plimbo', own: true, hasMainLead: true, departmentLeads: [] }]);
  const viewer = f.client('bob'); viewer.peer.floor = 'normal';
  f.ctx.cubbies.knock('normal', 'bob', cb.id, viewer.id);
  f.ctx.cubbies.admit('normal', 'alice', cb.id, 'bob', true);
  assert.ok(f.ctx.cubbies.state('normal', 'bob', viewer.id).cubbies[0].interior, 'fixture has an old sharing grant');
  const view = cubbiesView(f.ctx, f.ctx.floorOf(viewer), viewer)!;
  assert.equal(view.setupAllowed, false);
  assert.equal(view.cubbies[0].interior, undefined);
  assert.equal(view.cubbies[0].watching, undefined);
  assert.equal(view.cubbies[0].hqLead, undefined);
  const count = f.ctx.cubbies.records.rows.size;
  cubbiesHandlers['cubbies.setup'](f.ctx, viewer, { t: 'cubbies.setup', slot: 1, leadName: 'Removed', look: {} as any });
  cubbiesHandlers['cubbies.knock'](f.ctx, viewer, { t: 'cubbies.knock', id: cb.id });
  assert.equal(f.ctx.cubbies.records.rows.size, count);
  assert.match(JSON.stringify(viewer.ws.sent), /setup removed/);
  assert.match(JSON.stringify(viewer.ws.sent), /watch-only/);
  viewer.peer.floor = 'hq';
  assert.deepEqual(cubbiesView(f.ctx, f.ctx.floorOf(viewer), viewer), { enabled: false, cubbies: [], setupAllowed: false });
});
