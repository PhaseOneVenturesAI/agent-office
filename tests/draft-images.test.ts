import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cleanImage } from '../src/server/drafts/image-format.js';
import { readDesign, localDesign } from '../src/server/cubbies/local/design.js';
import { DraftImages } from '../src/server/cubbies/design-images.js';
import { DRAFT_LIMITS } from '../src/shared/protocol/drafts.js';
import { cleanDraftBoards } from '../src/server/drafts/boards.js';
import { draftImageRoute } from '../src/server/http/routes/draft-images.js';
import { boardFixture, png, pngChunk, jpeg, webp, webpChunk, imageFrames } from './support/draft-board.js';

test('PNG strips EXIF/GPS and text without changing retained chunks; malformed and non-images fail', () => {
  const dirty = Buffer.concat([png.subarray(0, 33), pngChunk('eXIf', Buffer.from('EXIF GPS private')), pngChunk('tEXt', Buffer.from('private')), png.subarray(33)]);
  const result = cleanImage(dirty);
  assert.deepEqual(result.bytes, png); assert.equal(result.meta.mime, 'image/png');
  assert.equal(result.meta.width, 1); assert.equal(result.meta.height, 1);
  assert.equal(cleanImage(png).meta.hash, result.meta.hash);
  for (const b of [Buffer.from('<svg>bad</svg>'), png.subarray(0, -1), Buffer.concat([png, Buffer.from('secret')])]) assert.throws(() => cleanImage(b));
});

test('JPEG strips APP1–15 and COM, retains APP0 and entropy data, and reads dimensions', () => {
  const segment = (marker: number, text: string) => { const data = Buffer.from(text), head = Buffer.from([255, marker, 0, data.length + 2]); return Buffer.concat([head, data]); };
  const app0 = segment(0xe0, 'JFIF');
  const dirty = Buffer.concat([jpeg.subarray(0, 2), app0, ...Array.from({ length: 15 }, (_, i) => segment(0xe1 + i, 'EXIF XMP ICC GPS private')), segment(0xfe, 'private comment'), jpeg.subarray(2)]);
  const result = cleanImage(dirty);
  assert.deepEqual(result.bytes, Buffer.concat([jpeg.subarray(0, 2), app0, jpeg.subarray(2)]));
  assert.deepEqual([result.meta.mime, result.meta.width, result.meta.height], ['image/jpeg', 3, 2]);
  assert.throws(() => cleanImage(dirty.subarray(0, -2)));
});

test('WebP removes metadata chunks, clears VP8X flags, fixes RIFF size; lossless and lossy dimensions', () => {
  const x = Buffer.alloc(10); x[0] = 0x2c; x[4] = 2; x[7] = 1;
  const data = webpChunk('VP8L', Buffer.from([0x2f, 2, 0x40, 0, 0]));
  const dirty = webp(webpChunk('VP8X', x), webpChunk('EXIF', Buffer.from('GPS')), webpChunk('XMP ', Buffer.from('private')), webpChunk('ICCP', Buffer.from('profile')), data);
  const result = cleanImage(dirty); x[0] = 0;
  assert.deepEqual(result.bytes, webp(webpChunk('VP8X', x), data));
  assert.deepEqual([result.meta.width, result.meta.height], [3, 2]);
  assert.equal(cleanImage(webp(data)).meta.width, 3);
  assert.equal(cleanImage(webp(webpChunk('VP8 ', Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 3, 0, 2, 0])))).meta.height, 2);
  assert.throws(() => cleanImage(dirty.subarray(0, -1)));
});

test('local images use content not extension and reject symlinks, traversal, oversized and odd files', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-design-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const design = path.join(dir, '.agent-office/design'); mkdirSync(design, { recursive: true });
  writeFileSync(path.join(design, 'wrong.txt'), png);
  assert.equal(readDesign(dir, 'design/wrong.txt').meta.mime, 'image/png');
  symlinkSync(path.join(design, 'wrong.txt'), path.join(design, 'link.png'));
  writeFileSync(path.join(design, 'big.png'), Buffer.alloc(DRAFT_LIMITS.imageBytes + 1));
  writeFileSync(path.join(design, 'fake.png'), '<svg>bad</svg>');
  for (const name of ['link.png', 'big.png', 'fake.png', '../draft.json', '..', '']) assert.throws(() => readDesign(dir, 'design/' + name));
  symlinkSync(design, path.join(design, 'alias'));
  assert.throws(() => readDesign(dir, 'design/alias/wrong.txt'));
  writeFileSync(path.join(dir, '.agent-office/draft.json'), JSON.stringify({ ideas: [{ title: 'Idea', image: 'design/wrong.txt' }], screens: [{ title: 'Bad', status: 'review', image: 'design/link.png' }] }));
  const local = localDesign(dir); assert.equal(local.images.size, 1); assert.equal(local.boards.ideas[0].image?.mime, 'image/png'); assert.equal(local.boards.screens[0].image, undefined);
});

test('chunks are ordered, bounded, hashed, checked against mime and current board references', () => {
  const image = cleanImage(Buffer.concat([png.subarray(0, -12), pngChunk('IDAT', Buffer.alloc(100_000)), png.subarray(-12)]));
  const boards = cleanDraftBoards({ screens: [{ title: 'Big', status: 'review', image: image.meta }] });
  const store = new DraftImages(), frames = imageFrames('draft', image); store.boards(boards);
  assert.ok(frames.length > 1); assert.ok(frames.every(f => Buffer.byteLength(JSON.stringify(f)) < 64 * 1024));
  store.accept(frames[1]); assert.equal(store.get(image.meta.hash), undefined);
  frames.forEach(f => store.accept(f)); assert.deepEqual(store.get(image.meta.hash)?.bytes, image.bytes);
  store.boards(cleanDraftBoards({})); assert.equal(store.get(image.meta.hash), undefined);
  frames.forEach(f => store.accept(f)); assert.equal(store.get(image.meta.hash), undefined);
  store.boards(boards);
  frames.forEach(f => store.accept({ ...f, mime: 'image/jpeg' })); assert.equal(store.get(image.meta.hash), undefined);
  frames.forEach((f, i) => store.accept(i === 0 ? { ...f, data: 'AAAA' + f.data.slice(4) } : f)); assert.equal(store.get(image.meta.hash), undefined);
  store.accept(frames[0]); store.reconnect(); frames.slice(1).forEach(f => store.accept(f)); assert.equal(store.get(image.meta.hash), undefined);
  assert.equal(store.accept({ ...frames[0], total: 99999 }), false);
});

test('office images are owner-only HTTP, no-store, removed with cards, floor and kickoff; never public', async t => {
  const f = boardFixture(t); f.upload();
  const ctx: any = { drafts: f.drafts, cubbies: f.cubbies, floors: new Map([[f.def.id, { def: f.def }]]) };
  const get = (owner: string, hash = f.image.meta.hash) => {
    const r: any = { status: 0, headers: {}, body: undefined, writeHead(status: number, headers: any) { this.status = status; this.headers = headers; return this; }, end(body: any) { this.body = body; } };
    draftImageRoute.handle(ctx, { res: r, path: `/api/drafts/${f.def.id}/images/${hash}`, session: { account: { id: owner } } } as any); return r;
  };
  const ok = get('alice'); assert.equal(ok.status, 200); assert.deepEqual(ok.body, png);
  assert.equal(ok.headers['Cache-Control'], 'private, no-store'); assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff'); assert.equal(ok.headers['Content-Security-Policy'], "default-src 'none'");
  assert.equal(get('bob').status, 404); assert.deepEqual(get('bob').body, get('alice', '0'.repeat(64)).body);
  f.publish({}); assert.equal(get('alice').status, 404);
  f.publish(f.boards); f.upload();
  await f.drafts.kickoff(f.def.id, 'Board', 'alice', f.cubbies);
  assert.equal(get('alice').status, 404);
  assert.equal((f.cubbies as any).images.size, 0);
  f.publish(f.boards); f.upload(); assert.equal((f.cubbies as any).images.size, 0);
  const bytes = execFileSync('git', ['--git-dir', path.join(f.dir, 'remotes/board.git'), 'show', 'main:design/screens/welcome.png']);
  assert.deepEqual(bytes, png);
  const read = (file: string) => execFileSync('git', ['--git-dir', path.join(f.dir, 'remotes/board.git'), 'show', 'main:' + file], { encoding: 'utf8' });
  assert.match(read('docs/BRIEF.md'), /Explore it/); assert.match(read('docs/FEEDBACK.md'), /Looks good/); assert.match(read('design/SCREENS.md'), /screens\/welcome.png/);
});

test('removed drafts and cubbies clear retained images; sleeping computers retain them', t => {
  const f = boardFixture(t); f.upload(); f.ws.close();
  assert.ok(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash));
  f.cubbies.records.rows.delete(f.setup.id); f.cubbies.refresh(); assert.equal((f.cubbies as any).images.size, 0);
  const g = boardFixture(t); g.upload(); g.building.remove(g.def.id, 'alice'); g.cubbies.refresh();
  assert.equal((g.cubbies as any).images.size, 0);
});

test('only sixteen referenced images fit in local publication and office memory', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'many-designs-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, '.agent-office/design'), { recursive: true });
  const screens = Array.from({ length: 24 }, (_, i) => {
    const bytes = Buffer.concat([png.subarray(0, -12), pngChunk('IDAT', Buffer.from([i])), png.subarray(-12)]);
    writeFileSync(path.join(dir, `.agent-office/design/${i}`), bytes);
    return { title: `Screen ${i}`, status: 'review', image: `design/${i}` };
  });
  writeFileSync(path.join(dir, '.agent-office/draft.json'), JSON.stringify({ screens }));
  const local = localDesign(dir); assert.equal(local.images.size, DRAFT_LIMITS.images);
  assert.equal(local.boards.screens.filter(s => s.image).length, DRAFT_LIMITS.images);
  const store = new DraftImages(); store.boards(local.boards);
  for (const img of local.images.values()) imageFrames('floor', img).forEach(f => store.accept(f));
  assert.equal((store as any).complete.size, DRAFT_LIMITS.images);
});

test('image sending retries backpressure without skipping chunks and stops on disconnect', async () => {
  const { sendDesignImages } = await import('../src/server/cubbies/local/design.js');
  const image = cleanImage(Buffer.concat([png.subarray(0, -12), pngChunk('IDAT', Buffer.alloc(100_000)), png.subarray(-12)]));
  const sent = new Set<string>(), frames: any[] = []; let attempts = 0;
  await sendDesignImages('floor', [image], sent, f => { if (++attempts === 2) return false; frames.push(f); return true; }, () => true);
  assert.deepEqual(frames.map(f => f.index), [0, 1, 2]); assert.equal(sent.size, 1);
  assert.deepEqual(Buffer.from(frames.map(f => f.data).join(''), 'base64'), image.bytes);
  sent.clear(); let current = true;
  await sendDesignImages('floor', [image], sent, () => { current = false; return false; }, () => current);
  assert.equal(sent.size, 0);
});

test('image contents must match the declared mime, and unadmitted computers cannot upload', t => {
  const f = boardFixture(t), store = new DraftImages();
  store.boards(cleanDraftBoards({ screens: [{ title: 'Pretend JPEG', status: 'review', image: { ...f.image.meta, mime: 'image/jpeg' } }] }));
  imageFrames(f.def.id, f.image).forEach(frame => store.accept({ ...frame, mime: 'image/jpeg' }));
  assert.equal(store.get(f.image.meta.hash), undefined);
  f.ws.close(); f.cubbies.dropDraftImages(f.def.id);
  f.upload(); assert.equal(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash), undefined);
  const node = f.nodes.invite('Other computer', 'private', 'bob', true);
  const { ws } = f;
  // The node extension independently binds node id and account to the admitted cubby.
  f.nodes.extension?.(node.id, 'bob', imageFrames(f.def.id, f.image)[0]);
  assert.equal(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash), undefined);
  assert.equal(ws.readyState, 3);
});

test('failed kickoff rolls back binary export and retains draft images for a retry', async t => {
  const f = boardFixture(t); f.upload();
  const launch = f.building.launchDraft.bind(f.building);
  f.building.launchDraft = () => { throw Error('Persistence failure'); };
  await assert.rejects(f.drafts.kickoff(f.def.id, 'Board', 'alice', f.cubbies), /save kickoff/);
  assert.deepEqual(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash)?.bytes, png);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: f.def.dir, encoding: 'utf8' }), '');
  assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: f.def.dir, encoding: 'utf8' }).trim(), '1');
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(path.join(f.def.dir, 'design')), false);
  assert.equal(existsSync(path.join(f.dir, 'remotes/board.git')), false);
  f.building.launchDraft = launch;
  await f.drafts.kickoff(f.def.id, 'Board', 'alice', f.cubbies);
  assert.equal(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash), undefined);
});

test('owner board exposes an image URL only when its bytes are ready to serve', t => {
  const f = boardFixture(t);
  const view = () => f.drafts.state(f.def.id, 'alice', f.cubbies).here!.boards.screens[0];
  assert.equal(view().image, undefined);
  f.upload(); assert.deepEqual(view().image, f.image.meta);
  f.publish({}); assert.equal(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash), undefined);
});
