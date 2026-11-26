import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CUBBY_HALL, HALL_OUTER, HALL_PLACES, HALL_WINDOWS } from '../src/shared/cubbyhall.js';
import { WALL_HEIGHT, WALL_T } from '../src/shared/layout.js';
import { wallRun } from '../src/client/world/office/shell.js';
import { Sky } from '../src/client/world/sky.js';
import { hallIndoors, sheltered, setHall, skyHall } from '../src/client/world/sky-rooms.js';
import { InteriorLights } from '../src/client/world/office/interior-lights.js';
import { ExteriorClearance, hallClearanceOffset } from '../src/client/world/office/exterior-clearance.js';

test('the open hall is indoors and sheltered; its roof and the closed hall are outdoors', () => {
  const p = { x: -23, y: 1.7, z: -7 };
  try {
    const sky = Object.assign(Object.create(Sky.prototype), { indoors: false, roof: false, level: 0.1, lampsOn: 1, night: { lamps: [] } }) as Sky;
    setHall(false);
    assert.equal(sky.lightAt(new THREE.Vector3(p.x, p.y, p.z)), 0.1);
    assert.equal(hallIndoors(p), false);
    assert.equal(sheltered(p.x, p.z), false);
    setHall(true);
    assert.equal(hallIndoors(p), true);
    assert.equal(sky.lightAt(new THREE.Vector3(p.x, p.y, p.z)), 1);
    assert.equal(sky.lightAt(new THREE.Vector3(p.x, WALL_HEIGHT + 0.03, p.z)), 0.1);
    assert.equal(sky.lightAt(new THREE.Vector3(p.x, -1, p.z)), 0.1);
    assert.equal(sheltered(p.x, p.z), true);
    assert.deepEqual(skyHall.value.toArray(), [HALL_OUTER.minX, HALL_OUTER.maxX, HALL_OUTER.minZ, HALL_OUTER.maxZ]);
    assert.equal(hallIndoors({ ...p, y: WALL_HEIGHT + 0.03 }), false);
    assert.equal(hallIndoors({ ...p, y: -1 }), false);
    assert.equal(hallIndoors({ ...p, x: HALL_OUTER.minX - 0.1 }), false);
    setHall(false);
    assert.equal(hallIndoors(p), false);
    assert.equal(sheltered(p.x, p.z), false);
    assert.deepEqual(skyHall.value.toArray(), [1, 0, 1, 0]);
  } finally { setHall(false); }
});

test('one real west opening per cubby, clear of each partition', () => {
  assert.equal(HALL_WINDOWS.length, 4);
  HALL_WINDOWS.forEach((w, i) => {
    const p = HALL_PLACES[i];
    assert.equal(w.u, p.z);
    assert.ok(w.width < p.width - 0.2);
    assert.ok(w.y0 > 0.8 && w.y1 < WALL_HEIGHT);
  });
});

test('registered lamps follow night, draft dim, restore, and hall closure without accumulating dimming', () => {
  const registry = new InteriorLights(), light = new THREE.PointLight(), mat = new THREE.MeshToonMaterial();
  let on = true;
  const off = registry.add({ active: () => on, lights: [{ light, power: 7 }], bulbs: [{ mat, day: 0.35 }] });
  registry.update(0);
  assert.equal(light.intensity, 0);
  assert.equal(mat.emissiveIntensity, 0.35);
  registry.update(1);
  assert.equal(light.intensity, 7);
  assert.equal(mat.emissiveIntensity, 1);
  registry.dim(0.2);
  assert.ok(Math.abs(light.intensity - 1.4) < 1e-9);
  assert.equal(mat.emissiveIntensity, 0.2);
  registry.update(1);
  registry.dim(0.2);
  assert.ok(Math.abs(light.intensity - 1.4) < 1e-9);
  registry.update(1);
  assert.equal(light.intensity, 7);
  on = false;
  registry.update(1);
  assert.equal(light.visible, false);
  assert.equal(light.intensity, 0);
  assert.equal(mat.emissiveIntensity, 0);
  off(); mat.dispose();
});

test('outdoor clearance moves the full footprint and collider, and restores exact closed-floor positions', () => {
  const clearance = new ExteriorClearance();
  const prop = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2));
  prop.position.set(-25, -3, 0);
  const collider = { minX: -26, maxX: -24, minZ: -1, maxZ: 1, top: 0 };
  const original = { ...collider };
  assert.equal(clearance.add(prop, [collider]), true);
  assert.equal(prop.position.x, -25);
  clearance.set(true);
  assert.ok(new THREE.Box3().setFromObject(prop).max.x <= HALL_OUTER.minX - 1);
  assert.equal(collider.maxX, HALL_OUTER.minX - 1);
  clearance.set(false);
  assert.equal(prop.position.x, -25);
  assert.deepEqual(collider, original);
  assert.equal(hallClearanceOffset({ minX: -27, maxX: -25, minZ: 13, maxZ: 15 }), 0, 'southern tree stays put');
  assert.equal(hallClearanceOffset({ minX: -53, maxX: -43, minZ: -12, maxZ: 0 }), 0, 'west neighbour stays put');
  prop.geometry.dispose();
});

test('the west wall has actual sightlines through all four window holes', () => {
  const wall = new THREE.Group(), paint = new THREE.MeshBasicMaterial();
  wallRun(wall, [], 'z', CUBBY_HALL.minX - WALL_T / 2, HALL_OUTER.minZ, HALL_OUTER.maxZ, -1, [...HALL_WINDOWS], { wall: paint, trim: paint } as never, [true, true]);
  wall.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const w of HALL_WINDOWS) {
    ray.set(new THREE.Vector3(CUBBY_HALL.minX + 0.5, 1.7, w.u), new THREE.Vector3(-1, 0, 0));
    assert.equal(ray.intersectObject(wall, true).length, 0, 'window center is a hole');
    ray.set(new THREE.Vector3(CUBBY_HALL.minX + 0.5, 1.7, w.u + w.width / 2 + 0.2), new THREE.Vector3(-1, 0, 0));
    assert.ok(ray.intersectObject(wall, true).length > 0, 'wall beside window remains solid');
  }
  paint.dispose();
});

test('a lamp\'s night stretch keeps less fill there at night, none by day, and only while it is active', () => {
  const registry = new InteriorLights();
  let on = true;
  const off = registry.add({ active: () => on, lights: [], bulbs: [], nightFill: { at: (x) => x < 0, level: 0.3 } });
  assert.equal(registry.fillAt(-1, 0, 0), 1, 'day: unchanged');
  assert.ok(Math.abs(registry.fillAt(-1, 0, 1) - 0.3) < 1e-9, 'night, in the stretch: dimmed');
  assert.ok(Math.abs(registry.fillAt(-1, 0, 0.5) - 0.65) < 1e-9, 'dusk: in between');
  assert.equal(registry.fillAt(1, 0, 1), 1, 'night, outside the stretch: unchanged');
  on = false;
  assert.equal(registry.fillAt(-1, 0, 1), 1, 'hall shut: unchanged');
  off();
});
