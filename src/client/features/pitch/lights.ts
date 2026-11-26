import * as THREE from 'three';
import { MEETING_ROOM as R } from '../../../shared/layout';
/** Only the meeting room's bulbs get material copies; shared office materials stay untouched. */
export class RoomBulbs {
  private rows: { mesh: THREE.Mesh; own: THREE.MeshToonMaterial; copy: THREE.MeshToonMaterial }[] = [];
  constructor(private root: THREE.Object3D) {}
  set(level: number) {
    if (level === 1) {
      for (const row of this.rows) { row.mesh.material = row.own; row.copy.dispose(); }
      this.rows = []; return;
    }
    if (!this.rows.length) {
      this.root.updateWorldMatrix(true, true);
      this.root.traverse(o => {
        if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshToonMaterial) || !o.material.emissive.getHex()) return;
        const p = o.getWorldPosition(new THREE.Vector3());
        if (p.y < 2.4 || p.y > R.height + 0.1 || p.x < R.minX || p.x > R.maxX || p.z < R.minZ || p.z > R.maxZ) return;
        const own = o.material, copy = own.clone(); o.material = copy; this.rows.push({ mesh: o, own, copy });
      });
    }
    for (const r of this.rows) r.copy.emissive.copy(r.own.emissive).multiplyScalar(level);
  }
}
