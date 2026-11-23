import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPARTMENTS, ELEVATOR, ELEVATOR_FRONT, FLOOR } from '../src/shared/layout.js';

test('department directory leaves the elevator shaft and approach clear', () => {
  const sign = { minX: DEPARTMENTS.x - DEPARTMENTS.width / 2 - 0.25, maxX: DEPARTMENTS.x + DEPARTMENTS.width / 2 + 0.25, minZ: DEPARTMENTS.z - 0.3, maxZ: DEPARTMENTS.z + 0.3 };
  const lift = { minX: ELEVATOR.x - ELEVATOR.width / 2 - 0.5, maxX: ELEVATOR.x + ELEVATOR.width / 2 + 0.5, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT + 2 };
  assert.ok(sign.maxX < lift.minX || sign.minX > lift.maxX || sign.maxZ < lift.minZ || sign.minZ > lift.maxZ, 'Directory obstructs elevator shaft or arrival path');
});
