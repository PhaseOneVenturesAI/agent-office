import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { visibleIntersections } from '../src/client/input/picking';

const ray = () => new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
function box(z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.position.z = z;
  mesh.updateMatrixWorld();
  return mesh;
}

test('hidden branches never raycast, while visible walls still occlude an interactable', () => {
  const root = new THREE.Group(), hidden = new THREE.Group();
  const invisible = box(-1), wall = box(-3), target = box(-5);
  target.userData.interact = { kind: 'desk' };
  hidden.add(invisible); hidden.visible = false;
  root.add(hidden, target, wall); root.updateMatrixWorld(true);
  let hiddenCalls = 0;
  const cast = invisible.raycast.bind(invisible);
  invisible.raycast = (r, hits) => { hiddenCalls++; cast(r, hits); };
  const hits = visibleIntersections(ray(), [root]);
  assert.equal(hiddenCalls, 0, 'invisible geometry costs no triangle intersections');
  assert.equal(hits[0].object, wall, 'keep non-interactive occluders');
  assert.ok(hits.some(h => h.object === target));
  hidden.visible = true;
  assert.equal(visibleIntersections(ray(), [root])[0].object, invisible, 'visibility changes apply immediately');
});

test('a pickable passed directly still honors its hidden ancestor', () => {
  const parent = new THREE.Group(), child = box(-2);
  parent.add(child); parent.visible = false; parent.updateMatrixWorld(true);
  let calls = 0; child.raycast = () => { calls++; };
  assert.deepEqual(visibleIntersections(ray(), [child]), []);
  assert.equal(calls, 0);
});

test('reach bounds the query without changing later unbounded third-person clicks', () => {
  const r = ray(), near = box(-3), distant = box(-20);
  assert.equal(visibleIntersections(r, [distant, near], 5)[0].object, near);
  assert.equal(visibleIntersections(r, [distant], 5).length, 0);
  assert.equal(r.far, Infinity);
  assert.equal(visibleIntersections(r, [distant])[0].object, distant);
  r.far = 2;
  assert.equal(visibleIntersections(r, [near], 5).length, 0, 'retain a stricter caller bound');
  assert.equal(r.far, 2);
});

test('new and moved pickables are queried without a stale scene cache', () => {
  const r = ray(), root = new THREE.Group(), first = box(-3);
  root.add(first); root.updateMatrixWorld(true);
  assert.equal(visibleIntersections(r, [root])[0].object, first);
  const added = box(-2); root.add(added); root.updateMatrixWorld(true);
  assert.equal(visibleIntersections(r, [root])[0].object, added);
  added.position.x = 3; root.updateMatrixWorld(true);
  assert.equal(visibleIntersections(r, [root])[0].object, first);
});

test('layers filter an object without excluding its children', () => {
  const root = new THREE.Group(), child = box(-2);
  root.layers.set(2); root.add(child); root.updateMatrixWorld(true);
  assert.equal(visibleIntersections(ray(), [root])[0].object, child);
  child.layers.set(2);
  assert.equal(visibleIntersections(ray(), [root]).length, 0);
});

test('custom raycast propagation and exceptions preserve Raycaster behavior', () => {
  const root = new THREE.Group(), child = box(-2), r = ray();
  root.add(child); root.updateMatrixWorld(true);
  root.raycast = () => false;
  assert.equal(visibleIntersections(r, [root]).length, 0);
  root.raycast = () => { throw new Error('custom ray failure'); };
  assert.throws(() => visibleIntersections(r, [root], 4), /custom ray failure/);
  assert.equal(r.far, Infinity);
});
