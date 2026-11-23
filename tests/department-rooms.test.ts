import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPARTMENT_ROOMS, departmentRoomWalls, roomDeskIds } from '../src/shared/department-rooms.js';
import { DESKS, DESK_SIZE, ELEVATOR_CAR, FLOOR, STAIRS, deskSeat } from '../src/shared/layout.js';

const overlaps = (a: readonly number[], b: readonly number[]) => a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2];

test('department studios retain distinct real desk pods and leave their chairs inside', () => {
  const seen = new Set<string>();
  for (const room of DEPARTMENT_ROOMS) {
    assert.equal(roomDeskIds(room.preset), room.desks);
    for (const id of room.desks) {
      assert.ok(!seen.has(id), `${id} belongs to only one room`);
      seen.add(id);
      const desk = DESKS.find((d) => d.id === id)!;
      assert.ok(desk, `${id} is an existing desk`);
      assert.ok(desk.x - DESK_SIZE.width / 2 > room.minX + 0.6);
      assert.ok(desk.x + DESK_SIZE.width / 2 < room.maxX - 0.6);
      const seat = deskSeat(desk, 0.93);
      assert.ok(seat.z > room.minZ + 0.6 && seat.z < room.maxZ - 0.6);
    }
  }
  assert.equal(seen.size, 12);
  assert.equal(DESKS.filter((d) => !seen.has(d.id)).length, 4, 'four shared desks stay outside the studios');
});

test('room walls preserve elevator, stairs, common corridor and 2m open doorways', () => {
  const elevator = [ELEVATOR_CAR.minX, ELEVATOR_CAR.maxX, ELEVATOR_CAR.minZ, ELEVATOR_CAR.maxZ];
  const stairs = [STAIRS.fromX, STAIRS.toX, STAIRS.minZ, STAIRS.maxZ];
  for (const room of DEPARTMENT_ROOMS) {
    assert.ok(room.minX > FLOOR.minX && room.maxX < FLOOR.maxX);
    assert.ok(room.minZ > FLOOR.minZ && room.maxZ < FLOOR.maxZ);
    const z = room.door.side === 'north' ? room.minZ : room.maxZ;
    const doorway = [room.door.x - 0.8, room.door.x + 0.8, z - 0.4, z + 0.4];
    for (const wall of departmentRoomWalls(room)) {
      assert.ok(!overlaps(wall, elevator), 'room never enters elevator');
      assert.ok(!overlaps(wall, stairs), 'room never enters stairs');
      assert.ok(!overlaps(wall, [-16, 5, -1, 1]), 'common corridor remains open');
      assert.ok(!overlaps(wall, doorway), 'portal has actual collision clearance');
    }
  }
});
