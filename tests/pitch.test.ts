import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cleanPitch, pitchUrl, pitchImages } from '../src/shared/pitch/clean.js';
import { localPitch } from '../src/server/cubbies/local/pitch.js';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { Nodes } from '../src/server/nodes.js';
import { memoryStore, pinOf } from '../src/server/cubbies/local/devices.js';
import { cubbyKey, relaySignature, verifyOwnerVerdict, verifyRelay } from '../src/server/cubbies/wire.js';
import { pitchChanged, pitchHandlers } from '../src/server/ws/handlers/pitch.js';
import { pitchImageRoute } from '../src/server/http/routes/pitch-images.js';
import { cleanImage } from '../src/server/drafts/image-format.js';
import { testOwnerKey } from './support/cubby-keys.js';
import { png, socket, imageFrames, pngChunk } from './support/draft-board.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
const raw = () => ({ department: 'Marketing', lead: 'Plimbo Marketing lead', version: 'v3', status: 'ready', pieces: [
  { id: 'home', kind: 'site', title: 'Home page', url: 'https://example.com', image: 'pitch/home.png', notes: ['Review this'] },
  { id: 'video', kind: 'video', title: 'Explainer', youtube: 'dQw4w9WgXcQ', image: 'pitch/home.png' },
  { id: 'slides', kind: 'slides', title: 'Launch deck', images: ['pitch/home.png'] },
  { id: 'ads', kind: 'ads', title: 'Ads', images: ['pitch/home.png', 'pitch/home.png'] },
] });
const tick = () => new Promise(r => setTimeout(r, 15));
function files(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pitch-'));
  mkdirSync(path.join(dir, '.agent-office/pitch'), { recursive: true });
  writeFileSync(path.join(dir, '.agent-office/pitch.json'), JSON.stringify(raw()));
  writeFileSync(path.join(dir, '.agent-office/pitch/home.png'), png);
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
test('pitch cleaner bounds text, kinds, ids, notes and all 34 image slots at both boundaries', () => {
  const image = cleanImage(png).meta, r: any = raw();
  r.pieces[0].image = image; r.pieces[1].image = image;
  r.pieces[2].images = Array(30).fill(image); r.pieces[3].images = Array(12).fill(image);
  r.pieces[0].notes = Array(20).fill('a\0'.repeat(200)); r.pieces[0].extra = 'private'; r.secret = 'no';
  const p = cleanPitch(r)!;
  assert.equal(p.pieces[2].images.length, 24); assert.equal(p.pieces[3].images.length, 8); assert.equal(pitchImages(p).length, 34);
  assert.equal(p.pieces[0].notes.length, 8); assert.ok(p.pieces[0].notes.every(n => n.length <= 300 && !n.includes('\0')));
  assert.equal('extra' in p.pieces[0], false); assert.equal('secret' in p, false); assert.deepEqual(cleanPitch(p), p);
  r.pieces[1].kind = 'site'; r.pieces[2].id = '../bad'; r.pieces[3].id = 'home'; assert.equal(cleanPitch(r)!.pieces.length, 1);
  r.pieces[0].image = { ...image, width: 16384, height: 16384 }; assert.equal(cleanPitch(r)!.pieces[0].image, undefined);
  assert.equal(cleanPitch({ ...r, status: 'unknown' }), undefined);
});
test('iframe URLs allow HTTPS and ports but reject unsafe schemes, credentials and parser tricks', () => {
  assert.equal(pitchUrl('https://example.com:8443/path?q=1'), 'https://example.com:8443/path?q=1');
  for (const v of ['javascript:alert(1)', 'data:text/html,hi', 'http://example.com', '//example.com', '/local', 'https://a:b@example.com', 'https://a@example.com', 'https://@example.com', 'https:example.com', 'https://example.com\n', 'https:\\example.com', {}, null]) assert.equal(pitchUrl(v), undefined, String(v));
});
test('local pitch refuses aliases, traversal, oversized records, unclean metadata and forged stamps', t => {
  const dir = files(t), file = path.join(dir, '.agent-office/pitch.json');
  const r: any = raw(); r.pieces[0].stamp = { requestId: 'fake', verdict: 'approve', at: 1 };
  const tagged = Buffer.concat([png.subarray(0, 33), pngChunk('tEXt', Buffer.from('GPS\0private')), png.subarray(33)]);
  writeFileSync(path.join(dir, '.agent-office/pitch/home.png'), tagged); writeFileSync(file, JSON.stringify(r));
  const got = localPitch(dir); assert.deepEqual([...got.images.values()][0].bytes, png); assert.equal(got.pitch!.pieces[0].stamp, undefined);
  for (const image of ['../private', 'design/home.png', 'pitch/../private', 'pitch/link.png']) {
    if (image.endsWith('link.png')) symlinkSync(path.join(dir, '.agent-office/pitch/home.png'), path.join(dir, '.agent-office/pitch/link.png'));
    r.pieces[0].image = image; writeFileSync(file, JSON.stringify(r)); assert.equal(localPitch(dir).pitch!.pieces[0].image, undefined);
  }
  writeFileSync(file, ' '.repeat(65537)); assert.throws(() => localPitch(dir));
  rmSync(file); writeFileSync(path.join(dir, 'private.json'), JSON.stringify(raw())); symlinkSync(path.join(dir, 'private.json'), file); assert.throws(() => localPitch(dir));
  rmSync(path.join(dir, '.agent-office'), { recursive: true }); mkdirSync(path.join(dir, 'alias')); symlinkSync(path.join(dir, 'alias'), path.join(dir, '.agent-office')); assert.throws(() => localPitch(dir));
});
function connector(t: any, busy = false) {
  const dir = files(t), now = Date.now(), owner = testOwnerKey(), stranger = testOwnerKey(), sent: any[] = [], turns: string[] = [];
  const binding = { cubbyId: 'cub', floorId: 'floor', ownerId: 'alice', computerId: 'computer', connectionId: 'connection' };
  const config: LocalConfig = { ownerKey: owner.ownerKey, project: dir, floor: 'floor', roots: [dir], branches: new Map(), state: dir, computerId: 'computer', provider: 'claude', session: 'session', executable: 'claude', claudeHome: dir, fresh: false };
  const deps = { now: () => now, release() {}, head: async () => undefined, devices: memoryStore([pinOf(owner.ownerKey, 'Owner', now)]),
    snapshot: async () => ({ t: 'cubby.snapshot' as const, floorId: 'floor', observedAt: now, agents: [], plan: [], needsYou: [], pitch: localPitch(dir).pitch }),
    lead: { busy, send: async (text: string) => { turns.push(text); return 'Received'; }, stop: async () => {} } };
  let c = new CubbyConnector(config, 'token', deps);
  const send = (f: any) => c.receive(JSON.stringify({ ...f, signature: relaySignature(cubbyKey('token'), f) }));
  const ready = () => { c.connected(f => { sent.push(f); }); send({ t: 'cubby.ready', ...binding }); };
  const note = (extra: any = {}, signer = owner) => { const f = { t: 'cubby.verdict', ...binding, pieceId: 'home', version: 'v3', verdict: 'change', note: 'Make it clearer', requestId: 'verdict', at: now, ...extra }; return { ...f, ownerSig: signer.signVerdict(f) }; };
  ready(); t.after(async () => c.close());
  return { dir, owner, stranger, sent, turns, send, note, file: path.join(dir, '.agent-office/pitch-feedback.json'),
    restart: async () => { await c.close(); c = new CubbyConnector(config, 'token', deps); ready(); } };
}
test('signed verdict is saved at 0600, echoed as a stamp, delivered to lead and refuses replay across restart', async t => {
  const f = connector(t); await tick(); const note = f.note();
  assert.equal(verifyOwnerVerdict(f.owner.ownerKey, note), true); f.send(note); await tick();
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(f.turns, ['Pitch verdict on Home page (v3): Change — Make it clearer']);
  assert.equal(localPitch(f.dir).pitch!.pieces[0].stamp?.requestId, 'verdict');
  assert.ok(f.sent.some(s => s.t === 'cubby.snapshot' && s.pitch?.pieces[0].stamp?.requestId === 'verdict'));
  const saved = readFileSync(f.file); f.send(note); await tick(); assert.deepEqual(readFileSync(f.file), saved);
  await f.restart(); await tick(); f.send(note); await tick(); assert.deepEqual(readFileSync(f.file), saved); assert.equal(f.turns.length, 1);
  assert.ok(f.sent.some(s => s.t === 'cubby.snapshot' && s.pitch?.pieces[0].stamp));
  assert.equal(f.sent.filter(s => s.t === 'cubby.design-image').length, 2, 'one shared image per connection');
});
test('forged, stale, replayed, wrong-version and invalid verdicts cannot change the saved file', async t => {
  const f = connector(t); await tick();
  for (const bad of [f.note({}, f.stranger), { ...f.note(), verdict: 'approve' }, f.note({ at: Date.now() - 61_000 }), f.note({ at: Date.now() + 61_000 }),
    f.note({ version: 'v2' }), f.note({ pieceId: 'unknown' }), f.note({ note: '' }), f.note({ note: 'a'.repeat(1001) }), f.note({ verdict: 'other' })]) f.send(bad);
  assert.equal(existsSync(f.file), false); assert.deepEqual(f.turns, []);
  f.send(f.note()); await tick(); const saved = readFileSync(f.file);
  f.send(f.note({ requestId: 'changed', version: 'v2' })); assert.deepEqual(readFileSync(f.file), saved);
  const target = path.join(f.dir, 'secret'); writeFileSync(target, '[]'); rmSync(f.file); symlinkSync(target, f.file);
  f.send(f.note({ requestId: 'alias' })); assert.equal(readFileSync(target, 'utf8'), '[]');
});
test('busy lead gets saved verdict without a concurrent turn; a new version clears stamps', async t => {
  const f = connector(t, true); await tick(); f.send(f.note()); await tick(); assert.equal(f.turns.length, 0);
  assert.equal(localPitch(f.dir).pitch!.pieces[0].stamp?.verdict, 'change');
  writeFileSync(path.join(f.dir, '.agent-office/pitch.json'), JSON.stringify({ ...raw(), version: 'v4' }));
  assert.equal(localPitch(f.dir).pitch!.pieces[0].stamp, undefined);
});
test('shared-floor owner-only delivery, chunked images, verdict relay and authenticated image endpoint', t => {
  const dir = files(t); let c!: Cubbies;
  const nodes = new Nodes(dir, () => c?.refresh()); t.after(() => nodes.close());
  c = new Cubbies(dir, true, nodes, id => id, id => id === 'floor', () => {});
  const a = c.setup('floor', 'alice', 0, 'Lead', {} as any), ws = socket();
  nodes.attach(ws as any, a.token); ws.frame({ t: 'hello', host: 'private', providers: [] });
  ws.frame({ t: 'cubby.hello', floorId: 'floor', computerId: 'computer-alice', computerName: 'Computer' });
  const p = localPitch(dir).pitch!, image = [...localPitch(dir).images.values()][0];
  ws.frame({ t: 'cubby.snapshot', floorId: 'floor', observedAt: Date.now(), agents: [], plan: [], needsYou: [], pitch: p });
  c.knock('floor', 'bob', a.id, 'bob-browser'); c.admit('floor', 'alice', a.id, 'bob', true);
  assert.equal(c.state('floor', 'bob', 'bob-browser').cubbies[0].watching, true);
  assert.ok(c.pitchView('floor', 'alice')); assert.equal(c.pitchView('floor', 'bob'), undefined);
  assert.equal(c.pitchView('floor', 'alice')!.pitch.pieces[0].image, undefined);
  imageFrames('floor', image).forEach(f => ws.frame(f)); assert.ok(c.pitchView('floor', 'alice')!.pitch.pieces[0].image);
  assert.equal(c.pitchImage(a.id, 'bob', image.meta.hash), undefined); assert.ok(c.pitchImage(a.id, 'alice', image.meta.hash));
  const alice = { accountId: 'alice' }, bob = { accountId: 'bob' }, frames: any[] = [];
  const ctx: any = { cubbies: c, clients: new Map([['a', alice], ['b', bob]]), floorOf: () => ({ id: 'floor' }), sendTo: (client: any, msg: any) => frames.push({ client, msg }) };
  pitchChanged(ctx); assert.ok(frames.find(f => f.client === alice).msg.view); assert.equal(frames.find(f => f.client === bob).msg.view, undefined);
  const owner = testOwnerKey(), binding = ws.sent.find(s => s.t === 'cubby.ready');
  const payload = { ...binding, pieceId: 'home', version: 'v3', verdict: 'approve', requestId: 'approve', at: Date.now() };
  const message = { ...payload, ownerSig: owner.signVerdict(payload) };
  assert.throws(() => c.verdict('floor', 'bob', a.id, message)); c.verdict('floor', 'alice', a.id, message);
  assert.equal(ws.sent.at(-1).t, 'cubby.verdict'); assert.equal(verifyRelay(cubbyKey(a.token), ws.sent.at(-1)), true);
  assert.equal(verifyRelay(cubbyKey(a.token), { ...ws.sent.at(-1), verdict: 'drop' }), false);
  ws.frame({ t: 'cubby.reply', floorId: 'floor', requestId: message.requestId, text: 'Private pitch reply' });
  assert.equal(c.pitchView('floor', 'alice')!.notice?.text, 'Private pitch reply');
  assert.equal(c.state('floor', 'alice').cubbies[0].interior!.chat.some(l => l.text.includes('Private pitch')), false);
  assert.equal(JSON.stringify(c.state('floor', 'bob', 'bob-browser')).includes('Private pitch'), false);
  const statuses: number[] = [], res: any = { writeHead: (code: number) => statuses.push(code), end() {} };
  for (const id of ['bob', 'alice']) pitchImageRoute.handle(ctx, { res, path: `/api/pitch/${a.id}/images/${image.meta.hash}`, session: { account: { id } } } as any);
  assert.deepEqual(statuses, [404, 200]);
  const warnings: string[] = []; ctx.warn = (_: any, s: string) => warnings.push(s);
  pitchHandlers['pitch.verdict'](ctx, bob as any, { ...message, t: 'pitch.verdict', cubbyId: a.id, floorId: 'floor' }); assert.equal(warnings.length, 1);
  const off = new Cubbies(dir, false, nodes, id => id, () => true, () => {}); assert.equal(off.pitchView('floor', 'alice'), undefined);
});
