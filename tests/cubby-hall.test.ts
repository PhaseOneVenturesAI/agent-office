// The cubby hall's geometry (shared/cubbyhall.ts): where it stands west of the office, its six cubbies
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

test('the hall is about 4 m wide, west of the west wall, from the north wall to short of the exit landing', () => {
  const H = hall.CUBBY_HALL;
  assert.equal(H.maxX, FLOOR.minX - WALL_T);
  assert.ok(H.maxX - H.minX > 3.5 && H.maxX - H.minX < 4.2);
  assert.ok(hall.HALL_OUTER.minX >= -22.3 - 1e-9, 'its outer wall stands no further out than x -22.3');
  assert.equal(H.minZ, FLOOR.minZ);
  assert.ok(hall.HALL_OUTER.maxZ <= EXIT_DOOR.u - EXIT_DOOR.width / 2, 'south of it, the exit door is untouched');
});

test('it keeps clear of the exit landing and stairs, the street and the road', () => {
  assert.equal(overlaps(hall.HALL_OUTER, hall.exitStairsBox()), false);
  // The west road's east edge is x -24 (see the brief); the street runs east–west south of the building.
  assert.ok(hall.HALL_OUTER.minX > -24);
  assert.ok(hall.HALL_OUTER.maxZ < ROAD.minZ);
});

test('six cubbies, about 3 m by 2.5 m, inside the hall, side by side, fronts east onto the corridor', () => {
  assert.equal(hall.HALL_PLACES.length, 6);
  assert.deepEqual(hall.HALL_PLACES.map((p) => p.slot), [0, 1, 2, 3, 4, 5]);
  for (const p of hall.HALL_PLACES) {
    assert.ok(inside(footprint(p), hall.CUBBY_HALL), `slot ${p.slot} is in the hall`);
    assert.ok(p.width > 2.8 && p.width < 3.2, `slot ${p.slot} is ~3 m along the hall`);
    assert.ok(p.depth >= 2.4 && p.depth <= 2.7, `slot ${p.slot} is ~2.5 m deep`);
    assert.equal(p.rotY, Math.PI / 2, 'its front (+z in its own frame) faces east');
    assert.ok(Math.abs(p.x + p.depth / 2 - hall.HALL_FRONT_X) < 1e-9, 'its front is on the corridor');
    assert.equal(overlaps(footprint(p), hall.exitStairsBox()), false);
  }
  for (let i = 1; i < 6; i++) assert.equal(overlaps(footprint(hall.HALL_PLACES[i - 1]), footprint(hall.HALL_PLACES[i])), false);
  assert.ok(hall.HALL_CORRIDOR >= 1.2 && hall.HALL_CORRIDOR <= 1.4);
  assert.equal(hall.hallPartitions().length, 5);
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
