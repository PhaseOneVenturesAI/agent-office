// Kickoff's client side (cubbies step 3), without a browser: what the store keeps of a kicked-off
// floor, the studio table's offer, the confirm rule, the kickoff moment's timeline, the lead's walk into
// the cubby hall, and what the Design book, the poster and the elevator say. The 3D floor itself is
// checked in a browser by tests/kickoff-ui.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const { Store } = await import('../src/client/state/store.js');
const { drafts } = await import('../src/client/state/slices/drafts.js');
const ko = await import('../src/client/features/drafts/kickoff-model.js');
const { DIM, LEAD_SPOTS, PODS, STUDIO } = await import('../src/client/features/drafts/model.js');
const { focusedOf } = await import('../src/client/features/cubbies/focus.js');
const { CUBBY_DOORWAY, HALL_FRONT_X, HALL_PLACES, inCubbyHall } = await import('../src/shared/cubbyhall.js');
const { FLOOR, STATIONS } = await import('../src/shared/layout.js');

function kept(state: unknown) {
  const s = new Store([drafts]);
  s.apply({ t: 'drafts', state } as never);
  return s.drafts;
}
const here = { id: 'draft-1', name: 'Kindly', createdAt: 1, online: true, designers: 0, boards: { decisions: [], plan: [], screens: [], brand: { colors: [] } } };
const launched = { name: 'Kindly', at: 5, repo: 'PhaseOneVenturesAI/kindly', brand: { name: 'Kindly', tagline: 'Your family’s week, in one calm place', colors: ['#ef476f', '#ffd166'] }, screens: ['Home', 'Calendar'] };

test('the store keeps canKickoff and what a kicked-off floor keeps, cleaned', () => {
  const s = kept({ enabled: true, canStart: true, here, canKickoff: true });
  assert.equal(s.canKickoff, true);
  assert.equal(kept({ enabled: true, canStart: true, here, canKickoff: 'yes' }).canKickoff, undefined);
  const l = kept({ enabled: true, canStart: false, launched: { ...launched, brand: { ...launched.brand, colors: ['#ef476f', 'red', 7] }, screens: ['  Home  ', 3, '', 'Calendar'], extra: 1 } }).launched;
  assert.deepEqual(l, { ...launched, brand: { ...launched.brand, colors: ['#ef476f'] } });
  assert.equal(kept({ enabled: true, canStart: false, launched: { name: '  ' } }).launched, undefined, 'no name, nothing kept');
  assert.equal(kept({ enabled: false, launched }).launched, undefined, 'an office without drafts keeps nothing');
});

test('the studio table offers K to kick off, or says why it can’t', () => {
  assert.equal(ko.KICKOFF_KEY, 'K');
  assert.deepEqual(ko.kickoffOffer({ here: here as never, canKickoff: true }), { can: true, label: 'Kick off' });
  assert.deepEqual(ko.kickoffOffer({ here: here as never }), { can: false, why: 'Kickoff isn’t set up in this office' });
  assert.equal(ko.kickoffOffer({ canKickoff: true }), null, 'nothing off a draft of yours');
});

test('Kick off wakes up only once the name typed is the project’s', () => {
  assert.equal(ko.confirmMatches('', 'Kindly'), false);
  assert.equal(ko.confirmMatches('Kind', 'Kindly'), false);
  assert.equal(ko.confirmMatches('kindly', 'Kindly'), false, 'the name as it is');
  assert.equal(ko.confirmMatches('  Kindly ', 'Kindly'), true);
  assert.equal(ko.confirmMatches('Plimbo   Studio', 'Plimbo Studio'), true);
});

test('the lights come on a desk row at a time, front to back, in about three seconds', () => {
  assert.equal(ko.DESK_ROWS.length, 4);
  assert.deepEqual([...ko.DESK_ROWS], [...ko.DESK_ROWS].sort((a, b) => a - b), 'front (by the elevator) first');
  assert.equal(ko.lightLevel(0), DIM);
  let last = 0;
  for (let ms = 0; ms <= 4000; ms += 50) {
    const l = ko.lightLevel(ms);
    assert.ok(l >= last - 1e-9, `never dims again (${ms} ms)`);
    last = l;
  }
  assert.ok(ko.lightLevel(1500) > 0.35 && ko.lightLevel(1500) < 0.75, 'about half on half way');
  assert.equal(ko.lightLevel(3100), 1, 'all on by about 3 s');
  // Each row is on before the next has got far.
  for (let i = 1; i < ko.DESK_ROWS.length; i++) assert.ok(ko.rowLit(i * ko.ROW_STEP_MS, i - 1) > 0.9);
});

test('the covers fly off one row after another, all gone before the floor is itself again', () => {
  const north = PODS.filter((p) => p.z < 0);
  const south = PODS.filter((p) => p.z > 0);
  for (const n of north) for (const s of south) assert.ok(ko.coverStart(n) < ko.coverStart(s));
  for (const p of PODS) {
    assert.equal(ko.coverLift(ko.coverStart(p), p), 0);
    assert.equal(ko.coverLift(ko.PANELS_FADE.from, p), 1, `${p.id} gone before the panels go`);
  }
  assert.equal(ko.panelsLeft(0), 1);
  assert.equal(ko.panelsLeft(ko.LEAVE_MS), 0);
});

test('the lead walks from the table through the doorway into cubby 0, round the desks and the table', () => {
  const { points, doorway } = ko.leadPath();
  assert.deepEqual(points[0], { x: LEAD_SPOTS.table.x, z: LEAD_SPOTS.table.z });
  const end = points[points.length - 1];
  assert.ok(end.x < HALL_FRONT_X && inCubbyHall(end.x, end.z), 'ends past cubby 0’s glass front');
  assert.ok(Math.abs(end.z - HALL_PLACES[0].z) < 0.01);
  assert.ok(points[doorway].x > FLOOR.minX && Math.abs(points[doorway].z - CUBBY_DOORWAY.u) < 0.01, 'waits on the floor side of the doorway');
  const len = ko.pathLength(points);
  const inBox = (x: number, z: number, b: { x: number; z: number; w: number; d: number }) => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2;
  for (let d = 0; d <= len; d += 0.1) {
    const at = ko.along(points, d);
    for (const p of PODS) assert.ok(!inBox(at.x, at.z, { x: p.x, z: p.z, w: p.width, d: p.depth }), `clear of pod ${p.id} at ${d.toFixed(1)} m`);
    assert.ok(!inBox(at.x, at.z, { x: STUDIO.x, z: STUDIO.z, w: STUDIO.width + 0.4, d: STUDIO.depth + 0.4 }), 'clear of the studio table');
    for (const s of STATIONS) assert.ok(Math.hypot(at.x - s.x, at.z - s.z) > 0.8, `clear of ${s.id}`);
    // Through the old west wall only by the doorway.
    if (at.x < FLOOR.minX) assert.ok(inCubbyHall(at.x, at.z), `in the hall at ${d.toFixed(1)} m`);
  }
  assert.equal(ko.along(points, 0).done, false);
  assert.equal(ko.along(points, len + 1).done, true);
  assert.deepEqual({ x: ko.along(points, len).x, z: ko.along(points, len).z }, end);
});

test('the Design book, the poster and the "New" badge', () => {
  const b = ko.designBook(launched);
  assert.equal(b.title, '📘 Design · Kindly');
  assert.deepEqual(b.screens, ['Home', 'Calendar']);
  assert.deepEqual(b.colors, ['#ef476f', '#ffd166']);
  assert.equal(ko.designBook({ ...launched, brand: { colors: [] }, screens: [] }).brand, 'Kindly', 'no brand name: the project’s');
  assert.deepEqual(ko.posterOf(launched), { name: 'Kindly', tagline: 'Your family’s week, in one calm place', colors: ['#ef476f', '#ffd166'] });
  assert.equal(ko.wearsNew({ isNew: true }), true);
  assert.equal(ko.wearsNew({}), false);
  assert.equal(ko.wearsNew({ isNew: true, draft: true }), false);
});

test('only one helper shows its tags: the one aimed at, else the nearest right in front within about a meter', () => {
  const at = (item: string, x: number, z: number, interact?: unknown) => ({ item, x, z, interact });
  const aimedIt = {};
  // Looking north (yaw 0 is -z) from the origin.
  const focus = { x: 0, z: 0, aimed: null, yaw: 0 };
  assert.equal(focusedOf([at('far', 0, -3), at('near', 0, -0.8), at('side', 0.9, -0.3)], focus), 'near');
  assert.equal(focusedOf([at('behind', 0, 0.6)], focus), undefined, 'not behind you');
  assert.equal(focusedOf([at('side', 0.7, -0.2)], focus), undefined, 'not off to the side');
  assert.equal(focusedOf([at('near', 0, -0.8), at('far', 5, 5, aimedIt)], { ...focus, aimed: aimedIt }), 'far', 'the one aimed at, wherever it is');
  assert.equal(focusedOf([at('near', 0, -0.8)]), undefined, 'no focus, no tags');
});
