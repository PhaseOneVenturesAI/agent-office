import * as THREE from 'three';
import type { OwnerColor } from '../../../../shared/personal-agents/appearance';

// Keep the frosted shapes' original translucency and unlit material; only their tint changes.
const materials = new Map<OwnerColor, THREE.MeshBasicMaterial>();
export function ownerSilhouette(color: OwnerColor): THREE.MeshBasicMaterial {
  let material = materials.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
    material.userData.shared = true;
    materials.set(color, material);
  }
  return material;
}
