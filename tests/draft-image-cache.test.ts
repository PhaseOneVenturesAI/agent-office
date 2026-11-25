import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftImageCache } from '../src/client/shared/drafts/image-cache.js';
import { draftImage, onDraftImage, syncDraftImages } from '../src/client/shared/drafts/images.js';
import { Store } from '../src/client/state/store.js';
import { drafts } from '../src/client/state/slices/drafts.js';
import { EMPTY_BOARDS, type DraftView } from '../src/shared/protocol/drafts.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const meta = { hash: 'a'.repeat(64), mime: 'image/png' as const, width: 4000, height: 4000 };
const here: DraftView = { id: 'floor', name: 'Draft', createdAt: 1, online: true, designers: 0,
  boards: { ...EMPTY_BOARDS, ideas: [{ id: 'idea', title: 'Idea', image: meta, feedback: [] }] } };

test('image LRU keeps 24 entries, touches reads and closes evictions exactly once', async () => {
  const cache = new DraftImageCache<{ close(): void }>();
  const closed: number[] = [];
  const read = (i: number) => cache.get(String(i), async () => ({ close() { closed.push(i); } }), () => {});
  for (let i = 0; i < 24; i++) { read(i); await tick(); }
  assert.deepEqual(closed, []);
  assert.ok(read(0));
  read(24); await tick(); assert.deepEqual(closed, [1]);
  read(25); await tick(); assert.deepEqual(closed, [1, 2]);
  cache.retain(new Set());
  assert.equal(closed.length, 26); assert.equal(new Set(closed).size, 26);
  cache.retain(new Set()); assert.equal(closed.length, 26);
});

test('removed pending images abort and close late decodes without replacing a new load', async () => {
  const cache = new DraftImageCache<{ close(): void }>();
  let finish!: (v: { close(): void }) => void;
  let aborted = false, closed = 0, changed = 0;
  cache.get('image', signal => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(resolve => { finish = resolve; }); }, () => changed++);
  cache.retain(new Set()); assert.equal(aborted, true);
  const fresh = { close() {} };
  cache.get('image', async () => fresh, () => changed++); await tick();
  finish({ close() { closed++; } }); await tick();
  assert.equal(closed, 1); assert.equal(changed, 1);
  assert.equal(cache.get('image', async () => null, () => {}), fresh);
});

test('oversize metadata falls back to text before fetching, including on the owner state path', t => {
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; throw Error('must not fetch'); });
  syncDraftImages(here);
  assert.equal(draftImage('floor', { ...meta, height: 4001 }), null);
  const store = new Store([drafts]);
  store.apply({ t: 'drafts', state: { enabled: true, canStart: true, here: { ...here,
    boards: { ...here.boards, ideas: [{ ...here.boards.ideas[0], image: { ...meta, height: 4001 } }] } } } });
  assert.equal(store.drafts.here?.boards.ideas[0].image, undefined);
  assert.equal(fetches, 0);
});

test('draft removal, kickoff, floor entry and card removal close decoded images', async t => {
  let closed = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new Blob(['image']), { headers: { 'content-type': 'image/png' } }));
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = (async () => ({ width: meta.width, height: meta.height, close() { closed++; } })) as any;
  t.after(() => { globalThis.createImageBitmap = previous; syncDraftImages(); });
  const store = new Store([drafts]);
  const show = () => store.apply({ t: 'drafts', state: { enabled: true, canStart: true, here } });
  const departures = [
    () => store.apply({ t: 'drafts', state: { enabled: true, canStart: true } }),
    () => store.apply({ t: 'drafts.kicked', floorId: 'floor', name: 'Draft', by: 'Owner' }),
    () => store.apply({ t: 'floor.enter', drafts: { enabled: true, canStart: true, here: { ...here, id: 'another' } } } as any),
    () => store.apply({ t: 'drafts', state: { enabled: true, canStart: true, here: { ...here, boards: EMPTY_BOARDS } } }),
  ];
  for (const [i, depart] of departures.entries()) {
    show();
    const loaded = new Promise<void>(resolve => { const off = onDraftImage(() => { off(); resolve(); }); });
    assert.equal(draftImage('floor', meta), undefined); await loaded;
    assert.ok(draftImage('floor', meta));
    depart(); assert.equal(closed, i + 1); assert.equal(draftImage('floor', meta), null);
  }
});
