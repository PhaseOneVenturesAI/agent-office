// The cubby hall's geometry (shared/cubbyhall.ts): where it stands west of the office, its four cubbies
// and the doorway in, clear of the street, the exit stairs, the ladder and the machine monitor.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as hall from '../src/shared/cubbyhall.js';
import { EXIT_DOOR, FLOOR, LADDER, MACHINE_MONITOR, ROAD, WALL_T, WINDOWS } from '../src/shared/layout.js';

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const E = 1e-9;
const overlaps = (a: Box, b: Box) => a.minX < b.maxX - E && b.minX < a.maxX - E && a.minZ < b.maxZ - E && b.minZ < a.maxZ - E;
const inside = (a: Box, b: Box) => a.minX >= b.minX - 1e-9 && a.maxX <= b.maxX + 1e-9 && a.minZ >= b.minZ - 1e-9 && a.maxZ <= b.maxZ + 1e-9;
/** A cubby's footprint on the floor (it faces east: its width runs along z, its depth along x). */
const footprint = (p: hall.HallPlace): Box => ({ minX: p.x - p.depth / 2, maxX: p.x + p.depth / 2, minZ: p.z - p.width / 2, maxZ: p.z + p.width / 2 });

test('the hall is about 6.4 m wide, west of the west wall, from the north wall to short of the exit landing', () => {
  const H = hall.CUBBY_HALL;
  assert.equal(H.maxX, FLOOR.minX - WALL_T);
  assert.ok(H.maxX - H.minX > 6.3 && H.maxX - H.minX < 6.5, '4 m cubby depth plus the existing corridor (Jonathan, 2026-11-26)');
  assert.ok(Math.abs(hall.HALL_OUTER.minX + 25) < E, 'outer wall at x -25');
  assert.equal(H.minZ, FLOOR.minZ);
  assert.ok(hall.HALL_OUTER.maxZ <= EXIT_DOOR.u - EXIT_DOOR.width / 2, 'south of it, the exit door is untouched');
});

test('it keeps clear of the exit landing and stairs, the street and the road', () => {
  assert.equal(overlaps(hall.HALL_OUTER, hall.exitStairsBox()), false);
  // Jonathan, 2026-11-26: the planned west road at x -24 moves or is dropped; no road exists there.
  // The actual south street, exit landing and stairs remain fixed.
  assert.ok(hall.HALL_OUTER.maxZ < ROAD.minZ);
});

test('four cubbies, about 4.4 m by 4.0 m, inside the hall, side by side, fronts east onto the corridor', () => {
  assert.equal(hall.HALL_PLACES.length, 4);
  assert.deepEqual(hall.HALL_PLACES.map((p) => p.slot), [0, 1, 2, 3]);
  for (const p of hall.HALL_PLACES) {
    assert.ok(inside(footprint(p), hall.CUBBY_HALL), `slot ${p.slot} is in the hall`);
    assert.ok(p.width > 4.2 && p.width < 4.6, `slot ${p.slot} is ~4.4 m along the hall`);
    assert.ok(Math.abs(p.depth - 4) < E, `slot ${p.slot} is ~4.0 m deep`);
    assert.equal(p.rotY, Math.PI / 2, 'its front (+z in its own frame) faces east');
    assert.ok(Math.abs(p.x + p.depth / 2 - hall.HALL_FRONT_X) < 1e-9, 'its front is on the corridor');
    assert.equal(overlaps(footprint(p), hall.exitStairsBox()), false);
  }
  for (let i = 1; i < 4; i++) assert.equal(overlaps(footprint(hall.HALL_PLACES[i - 1]), footprint(hall.HALL_PLACES[i])), false);
  assert.ok(hall.HALL_CORRIDOR >= 2.3 && hall.HALL_CORRIDOR <= 2.5, 'a 2.4 m corridor, not a slot');
  assert.equal(hall.hallPartitions().length, 3);
  for (const w of hall.hallPartitions()) for (const p of hall.HALL_PLACES) assert.equal(overlaps(w, footprint(p)), false);
});

test('the doorway is in the hall’s span, between the north wall and the first west window', () => {
  const d = hall.CUBBY_DOORWAY;
  assert.equal(d.wall, 'west');
  assert.equal(d.y0, 0);
  assert.ok(d.u - d.width / 2 > hall.CUBBY_HALL.minZ && d.u + d.width / 2 < hall.CUBBY_HALL.maxZ);
  for (const w of WINDOWS.filter((o) => o.wall === 'west')) assert.ok(d.u + d.width / 2 < w.u - w.width / 2 || d.u - d.width / 2 > w.u + w.width / 2, `clear of the window at ${w.u}`);
  const box = hall.doorwayBox();
  assert.equal(overlaps(box, LADDER.hatch), false, 'clear of the ladder and its hatch');
  assert.ok(box.maxZ < LADDER.z - LADDER.width / 2);
  assert.ok(box.maxZ < MACHINE_MONITOR.z - MACHINE_MONITOR.width / 2, 'clear of the machine monitor');
  assert.equal(hall.inCubbyHall((box.minX + box.maxX) / 2, d.u), true, 'the doorway counts as the hall');
  assert.equal(hall.inCubbyHall(-10, 0), false);
  assert.equal(hall.inCubbyHall(-19, 6.5), false, 'the exit landing is outside it');
  assert.equal(hall.inCubbyHall(hall.HALL_WAY_OUT.x, hall.HALL_WAY_OUT.z), false, 'the way out is on the open floor');
});

test('its walls box it in, and stand clear of the open floor', () => {
  for (const w of hall.hallWalls()) {
    assert.ok(inside(w.box, hall.HALL_OUTER), w.side);
    assert.equal(overlaps(w.box, FLOOR), false, w.side);
  }
});
