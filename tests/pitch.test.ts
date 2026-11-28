import { legacyCubby } from './support/legacy-cubby.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cleanPitch, pitchUrl, pitchImages } from '../src/shared/pitch/clean.js';
import { localPitch } from '../src/server/cubbies/local/pitch.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { Nodes } from '../src/server/nodes.js';
import { pitchChanged } from '../src/server/ws/handlers/pitch.js';
import { pitchImageRoute } from '../src/server/http/routes/pitch-images.js';
import { PitchStore } from '../src/server/pitch/store.js';
import { PITCH_LIMITS } from '../src/shared/protocol/pitch.js';
import { DRAFT_LIMITS } from '../src/shared/protocol/drafts.js';
import { cleanImage } from '../src/server/drafts/image-format.js';
import { png, socket, imageFrames, pngChunk } from './support/draft-board.js';
const raw = () => ({ department: 'Marketing', lead: 'Plimbo Marketing lead', version: 'v3', status: 'ready', pieces: [
  { id: 'home', kind: 'site', title: 'Home page', url: 'https://example.com', image: 'pitch/home.png', notes: ['Review this'] },
  { id: 'video', kind: 'video', title: 'Explainer', youtube: 'dQw4w9WgXcQ', image: 'pitch/home.png' },
  { id: 'slides', kind: 'slides', title: 'Launch deck', images: ['pitch/home.png'] },
  { id: 'ads', kind: 'ads', title: 'Ads', images: ['pitch/home.png', 'pitch/home.png'] },
] });
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
test('legacy publications retain owner-only delivery, chunked images and authenticated image endpoint', t => {
  const dir = files(t); let c!: Cubbies;
  const nodes = new Nodes(dir, () => c?.refresh()); t.after(() => nodes.close());
  c = new Cubbies(dir, true, nodes, id => id, id => id === 'floor', () => {});
  const a = legacyCubby(c, 'floor', 'alice', 0, 'Lead', {} as any), ws = socket();
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
  pitchChanged(ctx); assert.equal(frames.find(f => f.client === alice).msg.view.readOnly, true); assert.equal(frames.find(f => f.client === bob).msg.view, undefined);
  const statuses: number[] = [], res: any = { writeHead: (code: number) => statuses.push(code), end() {} };
  for (const id of ['bob', 'alice']) pitchImageRoute.handle(ctx, { res, path: `/api/pitch/${a.id}/images/${image.meta.hash}`, session: { account: { id } } } as any);
  assert.deepEqual(statuses, [404, 200]);
  const off = new Cubbies(dir, false, nodes, id => id, () => true, () => {}); assert.equal(off.pitchView('floor', 'alice'), undefined);
});

for (const reason of ['disconnect', 'record', 'floor', 'account', 'not-admitted', 'floor-image-cleanup']) {
  test(`pitch rows and images are released on ${reason}`, t => {
    const dir = files(t); let c!: Cubbies, floor = true, account = true;
    const nodes = new Nodes(dir, () => c?.refresh()); t.after(() => nodes.close());
    c = new Cubbies(dir, true, nodes, id => account ? id : undefined, () => floor, () => {});
    const a = legacyCubby(c, 'floor', 'alice', 0, 'Lead', {} as any), ws = socket();
    nodes.attach(ws as any, a.token); ws.frame({ t: 'hello', host: 'private', providers: [] });
    ws.frame({ t: 'cubby.hello', floorId: 'floor', computerId: 'computer-alice' });
    const { pitch, images } = localPitch(dir), image = [...images.values()][0];
    ws.frame({ t: 'cubby.snapshot', floorId: 'floor', observedAt: Date.now(), agents: [], plan: [], needsYou: [], pitch });
    imageFrames('floor', image).forEach(f => ws.frame(f));
    const store = (c as any).pitches as PitchStore;
    assert.ok(store.image(a.id, image.meta.hash));
    if (reason === 'disconnect') ws.close();
    if (reason === 'record') c.records.rows.delete(a.id);
    if (reason === 'floor' || reason === 'floor-image-cleanup') floor = false;
    if (reason === 'account') account = false;
    if (reason === 'not-admitted') (c as any).live.get(a.id).admitted = false;
    if (reason === 'floor-image-cleanup') c.dropDraftImages('floor');
    else if (reason !== 'disconnect') c.refresh();
    // Inspect storage as well as access control: hiding a stale row would still pin its memory.
    assert.equal(store.view(a.id, 'floor', 'computer-alice'), undefined);
    assert.equal(store.image(a.id, image.meta.hash), undefined);
  });
}

test('owner image budget spans cubbies, refuses extra images and releases capacity on removal', () => {
  const store = new PitchStore(), count = PITCH_LIMITS.ownerImageBytes / DRAFT_LIMITS.imageBytes;
  const images = Array.from({ length: count + 1 }, (_, i) => {
    const data = Buffer.alloc(DRAFT_LIMITS.imageBytes - 57, i);
    return cleanImage(Buffer.concat([png.subarray(0, 33), pngChunk('IDAT', data), png.subarray(-12)]));
  });
  const publication = (start: number, end: number) => ({ ...raw(), pieces: [{ id: 'slides', kind: 'slides', title: 'Slides', images: images.slice(start, end).map(i => i.meta) }] });
  store.publish('a', 'alice', publication(0, 8)); store.publish('b', 'alice', publication(8, images.length));
  const upload = (id: string, i: number) => imageFrames('floor', images[i]).map(f => store.accept(id, f));
  for (let i = 0; i < count; i++) assert.equal(upload(i < 8 ? 'a' : 'b', i).at(-1), true);
  assert.ok(upload('b', count).every(v => !v)); assert.equal(store.image('b', images[count].meta.hash), undefined);
  assert.equal(store.view('b', 'floor', 'computer')!.pitch.pieces[0].images.length, count - 8);
  for (let i = 0; i < count; i++) assert.ok(store.image(i < 8 ? 'a' : 'b', images[i].meta.hash), 'earlier image kept');
  store.publish('other', 'bob', publication(count, count + 1)); assert.equal(upload('other', count).at(-1), true, 'owners have independent budgets');
  store.drop('a'); assert.equal(upload('b', count).at(-1), true, 'dropped rows release the budget');
});

test('unfinished image chunks count toward the owner budget across cubbies', () => {
  const store = new PitchStore(), image = cleanImage(png), data = 'A'.repeat(DRAFT_LIMITS.chunk);
  // 34 simultaneous references per cubby can otherwise retain more than the owner budget.
  const metas = Array.from({ length: 34 }, (_, i) => ({ ...image.meta, hash: i.toString(16).padStart(64, '0') }));
  const pitch = { ...raw(), pieces: [
    { id: 'home', kind: 'site', title: 'Home', image: metas[0] }, { id: 'video', kind: 'video', title: 'Video', image: metas[1] },
    { id: 'slides', kind: 'slides', title: 'Slides', images: metas.slice(2, 26) }, { id: 'ads', kind: 'ads', title: 'Ads', images: metas.slice(26) },
  ] };
  store.publish('a', 'alice', pitch); store.publish('b', 'alice', pitch);
  for (const id of ['a', 'b']) for (const meta of metas) for (let index = 0; index < 40; index++) {
    store.accept(id, { ...meta, index, total: 50, data });
  }
  const rows = (store as any).rows as Map<string, { images: { bytes: number } }>;
  const bytes = [...rows.values()].reduce((n, r) => n + r.images.bytes, 0);
  assert.ok(bytes > 0 && bytes <= PITCH_LIMITS.ownerImageBytes, `retained ${bytes} bytes`);
});
