import * as THREE from 'three';
import type { Plate } from '../cubbies/personal-agents/declutter';
/** Keep close overhead labels inside a narrow viewport, while retaining the existing declutter rule. */
export function hqPlates(roots: THREE.Object3D[], camera: THREE.Camera): Plate[] {
  return roots.flatMap(owner => {
    const sprite = owner.getObjectByName('personal-nameplate') as THREE.Sprite | undefined;
    if (!sprite || !sprite.visible) return [];
    const previous = sprite.userData.hqFit ?? 1;
    sprite.scale.multiplyScalar(1 / previous);
    const size = sprite.getWorldScale(new THREE.Vector3());
    const at = sprite.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
    const factor = innerWidth < 600 && at.z < -.1 ? Math.min(1, -at.z * 1.5 / (size.x * camera.projectionMatrix.elements[0])) : 1;
    sprite.scale.multiplyScalar(factor); sprite.userData.hqFit = factor;
    return [{ sprite, owner, base: new THREE.Vector3(0, sprite.userData.base, 0) }];
  });
}
