import * as THREE from 'three';
import { declutter, overlaps, screenBox, type Plate, type ScreenBox } from '../cubbies/personal-agents/declutter';
/** Keep the usual distant size; close plates stop growing at 1.3× their size at 3 m. */
export function hqPlates(roots: THREE.Object3D[], camera: THREE.Camera): Plate[] {
  camera.updateMatrixWorld();
  return roots.flatMap(owner => {
    const sprite = owner.getObjectByName('personal-nameplate') as THREE.Sprite | undefined;
    if (sprite?.userData.hqHidden) { sprite.visible = true; delete sprite.userData.hqHidden; }
    if (!sprite || !sprite.visible) return [];
    // A status redraw can replace the scale between frames; never undo an old fit on new text.
    if (sprite.userData.hqFitted?.equals(sprite.scale)) sprite.scale.copy(sprite.userData.hqNatural);
    sprite.userData.hqNatural = sprite.scale.clone();
    const size = sprite.getWorldScale(new THREE.Vector3());
    const at = sprite.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
    const close = Math.min(1, Math.max(.001, -at.z) * 1.3 / 3);
    const phone = innerWidth < 600 && at.z < 0 ? -at.z * 1.5 / (size.x * camera.projectionMatrix.elements[0]) : 1;
    sprite.scale.multiplyScalar(Math.min(close, phone)); sprite.userData.hqFitted = sprite.scale.clone();
    return [{ sprite, owner, base: new THREE.Vector3(0, sprite.userData.base, 0) }];
  });
}

/** Cards are planes, not billboards: project their actual corners, including their rotation. */
function cardBox(card: THREE.Mesh, camera: THREE.Camera): ScreenBox | undefined {
  card.updateWorldMatrix(true, false);
  const vertices = card.geometry.getAttribute('position'), points: THREE.Vector3[] = [];
  for (let i = 0; i < vertices.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(card.matrixWorld));
  if (points.every(p => p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0)) return;
  points.forEach(p => p.project(camera));
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}

/** Leads keep their usual decluttering. Helpers can never cover a card or a lead plate. */
export function hqDeclutter(leads: THREE.Object3D[], helpers: THREE.Object3D[], cards: THREE.Mesh[], camera: THREE.Camera) {
  const leadPlates = hqPlates(leads, camera), helperPlates = hqPlates(helpers, camera);
  declutter(leadPlates, leads, camera);
  declutter(helperPlates, [...leads, ...helpers], camera);
  const blocked = cards.filter(c => c.visible).flatMap(c => cardBox(c, camera) ?? []);
  for (const { sprite } of leadPlates) {
    if (sprite.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse).z < 0) blocked.push(screenBox(sprite, camera));
  }
  for (const { sprite } of helperPlates) {
    const box = screenBox(sprite, camera);
    if (blocked.some(b => overlaps(box, b))) { sprite.visible = false; sprite.userData.hqHidden = true; }
    else blocked.push(box);
  }
}
