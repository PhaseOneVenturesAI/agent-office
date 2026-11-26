// Draft floors' client side, without a browser: what the store keeps of a draft, the pods and which
// ones a draft uncovers, where the lead stands, and what the boards and the studio table say. The 3D
// floor itself is checked in a browser by tests/drafts-ui.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DraftsState } from '../src/shared/protocol/drafts.js';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const { Store } = await import('../src/client/state/store.js');
const { SLICES } = await import('../src/client/state/slices/index.js');
const { drafts } = await import('../src/client/state/slices/drafts.js');
const NO_DRAFTS = { enabled: false, canStart: false };
const model = await import('../src/client/features/drafts/model.js');
const board = await import('../src/client/shared/drafts/board.js');
const { DESKS, ELEVATOR, ELEVATOR_FRONT, WHITEBOARD } = await import('../src/shared/layout.js');

function kept(state: unknown) {
  const s = new Store([drafts]);
  s.floor = 'draft-1';
  s.apply({ t: 'drafts', state } as never);
  return s.drafts;
}
const here = { id: 'draft-1', name: 'Kindly', createdAt: 1, online: true, designers: 1, boards: { ideas: [], decisions: [], plan: [], screens: [], brand: { colors: [] } } };

test('the slice follows cubbies, and starts with no drafts', () => {
  assert.equal(SLICES[SLICES.findIndex(s => 'cubbies' in (s.on ?? {})) + 1], drafts);
  assert.deepEqual(new Store([drafts]).drafts, NO_DRAFTS);
});

test('the store keeps nothing of a draft while the feature is off, and only clean text when on', () => {
  assert.deepEqual(kept({ enabled: false, canStart: true, here }), NO_DRAFTS);
  assert.deepEqual(kept(null), NO_DRAFTS);
  const s = kept({
    enabled: true,
    canStart: true,
    here: {
      ...here,
      name: '  Kindly \n  app ',
      leadName: 'Nova',
      designers: 9,
      boards: {
        decisions: ['One', 42, '', 'Two'],
        plan: 'not a list',
        screens: [{ title: 'Home', status: 'approved' }, { title: 'Odd', status: 'shipped' }, { title: '' }],
        brand: { name: 'Kindly', colors: ['#ef476f', 'red', '#FFD166', '#06d6a0;background:url(x)'] },
      },
    },
  } satisfies Record<string, unknown>);
  assert.equal(s.enabled, true);
  assert.equal(s.canStart, true);
  assert.equal(s.here?.name, 'Kindly app');
  assert.equal(s.here?.designers, 2, 'two pods at most');
  assert.deepEqual(s.here?.boards.decisions, ['One', 'Two']);
  assert.deepEqual(s.here?.boards.plan, []);
  assert.deepEqual(s.here?.boards.screens, [{ id: 'Home', title: 'Home', status: 'approved', feedback: [] }, { id: 'Odd', title: 'Odd', status: 'sketch', feedback: [] }]);
  assert.deepEqual(s.here?.boards.ideas, []);
  assert.deepEqual(s.here?.boards.brand, { name: 'Kindly', colors: ['#ef476f', '#FFD166'] });
  assert.equal(kept({ enabled: true, canStart: false, here: { ...here, name: '   ' } } as DraftsState).here, undefined, 'a draft with no name is no draft');
});

test('the design board keeps ideas, notes, image metadata and feedback, cleaned', () => {
  const hash = 'a'.repeat(64);
  const s = kept({
    enabled: true,
    canStart: true,
    here: {
      ...here,
      boards: {
        ideas: [
          { id: 'i1', title: '  Shared  calendar ', note: 'One place\r\nfor the   week', image: { hash, mime: 'image/png', width: 800, height: 600 }, feedback: [{ id: 'f2', text: 'Later', at: 20 }, { id: 'f1', text: ' Love\nit ', at: 10 }, { id: 'f1', text: 'dupe', at: 30 }, { id: '', text: 'no id', at: 1 }, { id: 'f3', text: '   ', at: 5 }] },
          { id: 'i1', title: 'Same id twice' },
          { id: 'i2', title: 'Bad image', image: { hash: '../../etc/passwd', mime: 'image/png', width: 1, height: 1 } },
          { id: 'i3', title: 'SVG', image: { hash, mime: 'image/svg+xml', width: 1, height: 1 } },
          { id: 'i4', title: 'Huge', image: { hash, mime: 'image/webp', width: 1e9, height: 2 } },
          { title: '' },
          'not a card',
        ],
        screens: [{ id: 's1', title: 'Home', status: 'review', note: 'x'.repeat(900), feedback: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, text: `note ${i}`, at: i })) }],
      },
    },
  } satisfies Record<string, unknown>);
  const [i1, ...rest] = s.here!.boards.ideas;
  assert.deepEqual(i1, { id: 'i1', title: 'Shared calendar', note: 'One place\nfor the week', image: { hash, mime: 'image/png', width: 800, height: 600 }, feedback: [{ id: 'f1', text: 'Love\nit', at: 10 }, { id: 'f2', text: 'Later', at: 20 }] });
  assert.deepEqual(rest.map((i) => [i.id, i.image]), [['i2', undefined], ['i3', undefined], ['i4', undefined]], 'a repeated id, a bad hash, an unknown type and an absurd size are dropped');
  const home = s.here!.boards.screens[0];
  assert.equal(home.note?.length, 400);
  assert.equal(home.feedback.length, 20, 'twenty notes a card at most');
  assert.equal(home.feedback.at(-1)?.text, 'note 29', 'the newest kept, newest last');
});

test('the cards each board shows, their badges, and when a sent note has landed', () => {
  const b = { ideas: [{ id: 'i1', title: 'Calendar', feedback: [] }], decisions: [], plan: [], screens: [{ id: 's1', title: 'Home', status: 'review' as const, note: 'n', feedback: [{ id: 'f1', text: 'Bigger', at: 1 }] }], brand: { colors: [] } };
  assert.deepEqual(board.boardCards(b, 'ideas').map((c) => [c.board, c.id, c.status]), [['ideas', 'i1', undefined]]);
  assert.deepEqual(board.boardCards(b, 'screens').map((c) => [c.board, c.id, c.status, c.note]), [['screens', 's1', 'review', 'n']]);
  assert.equal(board.findCard(b, 'screens', 's1')?.title, 'Home');
  assert.equal(board.findCard(b, 'ideas', 's1'), undefined);
  assert.equal(board.feedbackBadge(board.findCard(b, 'screens', 's1')!), '💬 1');
  assert.equal(board.feedbackBadge(board.findCard(b, 'ideas', 'i1')!), '');
  assert.equal(board.openLabel({ title: 'Home' }), 'Open Home');
  assert.equal(board.openLabel({ title: 'A really very long screen title indeed' }).length, 'Open '.length + 28);
  const card = { feedback: [{ id: 'old', text: 'Bigger', at: 1 }] };
  assert.equal(board.feedbackLanded(card, { requestId: 'r1', text: 'Bigger', before: new Set(['old']) }), false, 'the same words already there are not it');
  assert.equal(board.feedbackLanded({ feedback: [...card.feedback, { id: 'r1', text: 'Bigger!', at: 2 }] }, { requestId: 'r1', text: 'Bigger', before: new Set(['old']) }), true);
  assert.equal(board.feedbackLanded({ feedback: [...card.feedback, { id: 'x9', text: 'Bigger', at: 2 }] }, { requestId: 'r1', text: 'Bigger', before: new Set(['old']) }), true);
});

test('arriving on a floor takes its drafts piece, and a floor without one has none', () => {
  const s = new Store(SLICES);
  s.floor = 'draft-1';
  drafts.enter!(s, { drafts: { enabled: true, canStart: true, here } } as never);
  assert.equal(s.drafts.here?.id, 'draft-1');
  drafts.enter!(s, {} as never);
  assert.deepEqual(s.drafts, NO_DRAFTS);
});

test('four pods of four desks, nearest the studio table first, uncovered two at most', () => {
  assert.equal(model.PODS.length, 4);
  assert.deepEqual(model.PODS.flatMap((p) => p.desks.map((d) => d.id)).sort(), DESKS.map((d) => d.id).sort());
  for (const p of model.PODS) {
    assert.equal(p.desks.length, 4);
    for (const d of p.desks) assert.ok(Math.abs(d.x - p.x) < p.width / 2 && Math.abs(d.z - p.z) < p.depth / 2, `${d.id} is under its pod's sheet`);
  }
  const dist = (p: { x: number; z: number }) => Math.hypot(p.x - model.STUDIO.x, p.z - model.STUDIO.z);
  const order = model.PODS_BY_STUDIO.map(dist);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(model.uncoveredPods(0).size, 0);
  assert.deepEqual([...model.uncoveredPods(1)], [model.PODS_BY_STUDIO[0].id]);
  assert.equal(model.uncoveredPods(2).size, 2);
  assert.equal(model.uncoveredPods(7).size, 2);
  assert.equal(model.uncoveredPods(Number.NaN).size, 0);
});

test('the studio table stands where the whiteboard does; the lead greets you outside the doors, then waits behind it', () => {
  assert.equal(model.STUDIO.x, WHITEBOARD.x);
  assert.equal(model.STUDIO.z, WHITEBOARD.z);
  const g = model.LEAD_SPOTS.greet;
  assert.ok(g.z > ELEVATOR_FRONT + 1, 'outside the car, not in the doorway');
  assert.ok(Math.abs(g.x - ELEVATOR.x) < 2);
  const t = model.LEAD_SPOTS.table;
  assert.ok(t.z < model.STUDIO.z - model.STUDIO.depth / 2, 'on the table’s far side');
  // In the car, or just out of it, you haven't passed it yet; further in, you have.
  assert.equal(model.walkedPast(ELEVATOR.x, ELEVATOR_FRONT - 1), false);
  assert.equal(model.walkedPast(ELEVATOR.x, ELEVATOR_FRONT + 0.5), false);
  assert.equal(model.walkedPast(g.x, g.z + 1), true);
  assert.equal(model.walkedPast(ELEVATOR.x - 7, ELEVATOR_FRONT + 1), true);
});

test('the lead’s name and greeting, and what E does at the table', () => {
  assert.equal(model.leadName({ leadName: 'Nova' }), 'Nova');
  assert.equal(model.leadName({}, 'Atlas'), 'Atlas');
  assert.equal(model.leadName(undefined), 'Your lead');
  assert.equal(model.leadName({ leadName: 'A very long lead name indeed' }).length, 20);
  assert.equal(model.greeting({ name: 'Kindly' }), 'Welcome to Kindly');
  assert.deepEqual(model.studioAction({ cubbyId: 'c1' }, 'Nova'), { label: 'Talk to Nova', talk: true });
  assert.deepEqual(model.studioAction({}, 'Nova'), { label: 'Set up', talk: false });
});

test('the boards: Decisions, Plan and Screens in the Issues, Task queue and PR places, Ideas over Services, each saying what to expect', () => {
  assert.deepEqual(model.DRAFT_BOARDS.map((b) => [b.at, b.title]), [['issues', '📝 Decisions'], ['queue', '🗺️ Plan'], ['pulls', '🖼️ Screens']]);
  assert.deepEqual([model.IDEAS_BOARD.at, model.IDEAS_BOARD.title], ['services', '💡 Ideas']);
  for (const b of [...model.DRAFT_BOARDS, model.IDEAS_BOARD]) assert.match(b.empty, /appear|hang/);
  assert.deepEqual(Object.keys(model.SCREEN_CHIP).sort(), ['approved', 'review', 'sketch']);
  // Six cards, three across, inside the panel and clear of each other.
  const rects = model.cardRects(1536, 1056, 160);
  assert.equal(rects.length, 6);
  for (const r of rects) assert.ok(r.x >= 0 && r.y >= 160 && r.x + r.w <= 1536 && r.y + r.h <= 1056 && r.w > 400 && r.h > 350, JSON.stringify(r));
  assert.ok(rects[0].x + rects[0].w < rects[1].x && rects[0].y + rects[0].h < rects[3].y);
  const b = { ideas: [], decisions: ['a'], plan: [], screens: [{ id: 'Home', title: 'Home', status: 'review' as const, feedback: [] }], brand: { colors: [] } };
  assert.deepEqual(model.boardLines(b, 'screens'), ['Home']);
  assert.deepEqual(model.boardLines(b, 'plan'), []);
  assert.equal(model.brandEmpty(b.brand), true);
  assert.equal(model.brandEmpty({ colors: ['#000000'] }), false);
  assert.deepEqual(model.shown([1, 2, 3], 3), { items: [1, 2, 3], more: 0 });
  assert.deepEqual(model.shown([1, 2, 3, 4, 5], 3), { items: [1, 2], more: 3 });
  assert.ok(model.DIM > 0 && model.DIM < 0.3, 'the lights well down, not out');
});
