// Keep movable west-lawn props clear of the optional hall. Closed floors retain their exact positions.
import * as THREE from 'three';
import { HALL_OUTER, type Box } from '../../../shared/cubbyhall';
import type { Collider } from '../types';
import type { Fixture } from './fixture';

/** Westward displacement of the whole footprint, with a metre of air beside the hall. */
export function hallClearanceOffset(b: Box): number {
  const h = HALL_OUTER;
  if (b.maxX <= h.minX - 1 || b.minX >= h.maxX + 1 || b.maxZ <= h.minZ - 1 || b.minZ >= h.maxZ + 1) return 0;
  return h.minX - 1 - b.maxX;
}

export class ExteriorClearance {
  private on = false;
  private moves: { root: THREE.Object3D; x: number; dx: number; cols: { c: Collider; min: number; max: number }[] }[] = [];
  /** Call before merging: moved groups must keep their own transform. Returns whether it can move. */
  add(root: THREE.Object3D, colliders: Collider[] = []): boolean {
    const b = new THREE.Box3().setFromObject(root);
    for (const c of colliders) {
      b.expandByPoint(new THREE.Vector3(c.minX, 0, c.minZ));
      b.expandByPoint(new THREE.Vector3(c.maxX, 0, c.maxZ));
    }
    const dx = hallClearanceOffset({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
    if (!dx) return false;
    const move = { root, x: root.position.x, dx, cols: colliders.map(c => ({ c, min: c.minX, max: c.maxX })) };
    this.moves.push(move);
    this.apply(move);
    return true;
  }
  set(on: boolean) {
    this.on = on;
    for (const move of this.moves) this.apply(move);
  }
  private apply(m: ExteriorClearance['moves'][number]) {
    const dx = this.on ? m.dx : 0;
    m.root.position.x = m.x + dx;
    for (const { c, min, max } of m.cols) { c.minX = min + dx; c.maxX = max + dx; }
  }
}

declare module '../types' { interface OfficeHandles { exteriorClearance: ExteriorClearance } }
export const exteriorClearance: Fixture<'exteriorClearance'> = () => ({ handle: { exteriorClearance: new ExteriorClearance() } });
