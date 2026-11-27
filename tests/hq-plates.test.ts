import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hqDeclutter, hqPlates } from '../src/client/features/hq/plates.js';
import { overlaps, screenBox } from '../src/client/features/cubbies/personal-agents/declutter.js';

function fixture(t: any, width = 1280) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
  Object.defineProperty(globalThis, 'innerWidth', { value: width, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'innerWidth', previous); else delete (globalThis as any).innerWidth; });
  const camera = new THREE.PerspectiveCamera(60, width / 800, .01, 100);
  camera.position.y = 1.6; camera.updateMatrixWorld();
  const person = (z: number) => {
    const root = new THREE.Group(), sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    root.position.z = z; sprite.name = 'personal-nameplate'; sprite.position.y = sprite.userData.base = 2;
    sprite.scale.set(1.8, .3, 1); root.add(sprite);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.3, .4, .3)); head.position.y = 1.5; root.add(head);
    t.after(() => { sprite.material.dispose(); head.geometry.dispose(); (head.material as THREE.Material).dispose(); });
    return { root, sprite };
  };
  return { camera, person };
}

for (const width of [1280, 390]) test(`HQ plates cap close size and survive redraws at ${width}px`, t => {
  const { camera, person } = fixture(t, width), { root, sprite } = person(-3);
  const measure = () => { hqPlates([root], camera); const box = screenBox(sprite, camera); return box.maxX - box.minX; };
  const reference = measure();
  for (const distance of [2, 1, .1, 1, 3]) {
    root.position.z = -distance;
    const size = measure(); assert.ok(size <= reference * 1.3 + 1e-6);
    assert.ok(Math.abs(measure() - size) < 1e-6, 'repeated frames do not compound the fit');
  }
  root.position.z = -1; measure();
  sprite.scale.set(2.1, .3, 1); // A changed status redraws the nameplate at its natural size.
  measure(); root.position.z = -6; measure();
  assert.ok(Math.abs(sprite.scale.x - 2.1) < 1e-6, 'a redraw must not inherit the previous fit');
});

test('HQ helpers yield to cards and leads, then return when the view clears', t => {
  const { camera, person } = fixture(t), lead = person(-3), helper = person(-2);
  hqDeclutter([lead.root], [], [], camera);
  const leadPosition = lead.sprite.position.clone(), leadOpacity = lead.sprite.material.opacity;
  hqDeclutter([lead.root], [helper.root], [], camera);
  assert.deepEqual(lead.sprite.position, leadPosition, 'closer helpers cannot displace leads');
  assert.equal(lead.sprite.material.opacity, leadOpacity);
  assert.ok(!helper.sprite.visible || !overlaps(screenBox(helper.sprite, camera), screenBox(lead.sprite, camera)));
  const card = new THREE.Mesh(new THREE.PlaneGeometry(5, 5)); card.position.set(0, 2, -2.5); card.rotation.y = .2;
  t.after(() => { card.geometry.dispose(); card.material.dispose(); });
  hqDeclutter([lead.root], [helper.root], [card], camera);
  assert.equal(helper.sprite.visible, false);
  helper.root.position.x = 10;
  hqDeclutter([lead.root], [helper.root], [card], camera);
  assert.equal(helper.sprite.visible, true, 'a previously hidden helper returns outside the protected boxes');
});
