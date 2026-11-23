import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, FLOOR, WALL_T, WING, WING_DESKS, builtDesks } from '../src/shared/layout.js';
import { STUDIO_DOOR, STUDIO_WING, STUDIO_WING_FLOOR, STUDIO_WING_PROPS, STUDIO_WING_ROOMS, inStudioWing } from '../src/shared/studio-wing.js';
import { officeNav, route, walkable } from '../src/shared/nav.js';
import { groundAt } from '../src/client/player/collide.js';

// The studio wing: the annex behind the north wall, its doorway, and walkable routes from the office
// to each studio and back. Everything the wing adds is additive: every existing desk, seat and wing
// row is exactly where it was.

test('every existing desk is where it always was', () => {
  assert.equal(DESKS.length, 16);
  assert.equal(WING_DESKS.length, 4);
  assert.deepEqual(DESKS[0], { id: 'desk-1', x: -11.6, z: -4.55, rotY: Math.PI, label: 'Desk 1' });
  assert.equal(builtDesks(2).length, 20);
});

test('the annex fits the block, short of the street behind and clear of the back office bay', () => {
  // The city block runs to x ±22 with the north street's road from z -33..-25 and its sidewalk to -23.
  assert.ok(STUDIO_WING.minX > -22 && STUDIO_WING.maxX < 22, 'inside the block east-west');
  assert.ok(STUDIO_WING.backZ > -23, 'short of the sidewalk behind');
  assert.ok(STUDIO_WING.maxX < WING.minX, 'clear of the back office bay');
  assert.equal(STUDIO_WING.frontZ, FLOOR.minZ - WALL_T);
  // The doorway is through the solid stretch of the north wall, west of the back office bay.
  assert.ok(Math.abs(STUDIO_DOOR.u) + STUDIO_DOOR.width / 2 < WING.minX, 'doorway west of the wing bay');
  for (const room of STUDIO_WING_ROOMS) {
    assert.ok(room.minX >= STUDIO_WING.minX && room.maxX <= STUDIO_WING.maxX, `${room.name} inside the annex`);
    assert.ok(room.doorX - 0.7 > room.minX && room.doorX + 0.7 < room.maxX, `${room.name} doorway inside its front`);
  }
  for (const [x0, x1, z0, z1] of STUDIO_WING_PROPS) {
    assert.ok(x0 >= STUDIO_WING.minX && x1 <= STUDIO_WING.maxX && z0 >= STUDIO_WING.backZ && z1 <= STUDIO_WING.frontZ, `prop (${x0},${z0}) inside the annex`);
  }
});

test('the doorway through the north wall is walkable, the wall beside it is not', () => {
  assert.ok(walkable(0, -12.65), 'office side of the doorway');
  assert.ok(walkable(0, -13.15), 'through the wall');
  assert.ok(walkable(0, -13.65), 'hallway side of the doorway');
  assert.ok(!walkable(2.2, -13.15), 'the wall beside the doorway');
  assert.ok(inStudioWing(0, -14.5) && !inStudioWing(0, -12), 'the wing is behind the wall only');
});

test('the hallway, every studio doorway and every studio floor are walkable; the glass is not', () => {
  assert.ok(walkable(0, -14.5), 'the hallway');
  for (const room of STUDIO_WING_ROOMS) {
    const mid = (room.minX + room.maxX) / 2;
    assert.ok(walkable(room.doorX, -16.15), `${room.name} doorway, hallway side`);
    assert.ok(walkable(room.doorX, -16.65), `${room.name} doorway, studio side`);
    assert.ok(walkable(mid, -18.3), `${room.name} floor`);
    assert.ok(!walkable((room.doorX + room.maxX) / 2, -16.4), `${room.name} glass front`);
  }
  assert.ok(!walkable(-4, -19), 'the partition between marketing and product');
  assert.ok(!walkable(4, -19), 'the partition between product and development');
});

/** Every interpolated step along a route is on open floor. */
const assertRouteClear = (pts: [number, number][], wing = 0) => {
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      assert.ok(walkable(x, z, wing), `step into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
};

test('the annex floor holds you up, at its doorway seam too', () => {
  // Without the slab there is nothing under the annex: whoever walks in drops to the street below.
  assert.equal(groundAt([], 0, -14.5, 0), -Infinity);
  const colliders = [{ ...STUDIO_WING_FLOOR }];
  for (const [x, z] of [
    [0, -14.5],
    [9.8, -14.6],
    [-9.8, -14.6],
    [0, -19],
    [-7.5, -19],
    [7.5, -19],
    [0, -13.15],
    [-0.4, -13.05],
  ] as const)
    assert.equal(groundAt(colliders, x, z, 0), 0, `floor under (${x}, ${z})`);
});

test('you can walk from the office to each studio and back', () => {
  const from: [number, number] = [0, -11.5];
  for (const room of STUDIO_WING_ROOMS) {
    const mid: [number, number] = [(room.minX + room.maxX) / 2, -18.3];
    const there = route(from, mid);
    assert.deepEqual(there[there.length - 1], mid, `${room.name}: route reaches the studio`);
    assertRouteClear(there);
    const back = route(mid, from);
    assert.deepEqual(back[back.length - 1], from, `${room.name}: route returns to the office`);
    assertRouteClear(back);
  }
  // And from a desk on the office floor, without leaving the floor: desk-1's aisle to the product studio.
  const fromDesk = route([-10.5, -2.4], [0, -18.3]);
  assertRouteClear(fromDesk);
});

test('building the back office out stays independent of the wing', () => {
  for (const level of [0, 1, 2]) {
    const nav = officeNav(level);
    assert.ok(nav.walkable(0, -14.5), `hallway walkable at wing level ${level}`);
    assert.ok(nav.walkable(0, -18.3), `product studio walkable at wing level ${level}`);
  }
  // The wing bay behind the north wall is not walkable until it's built out, and the annex never blocks it.
  assert.ok(!walkable(15.7, -15), 'wing bay walled up at level 0');
  for (const level of [1, 2]) {
    assert.ok(walkable(14.2, -15, level), `wing bay walkable at level ${level}`);
    const way = route([14.2, -15], [0, -14.5], level);
    assertRouteClear(way, level);
  }
  assert.ok(!walkable(12.5, -18), 'the slot between the annex and the wing bay stays out of bounds');
});
