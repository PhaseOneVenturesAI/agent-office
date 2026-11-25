// The loft's own lamps on a draft: the Boss Office's pendant and the meeting room's ceiling lights glow
// by themselves (an emissive bulb doesn't care how bright the room's lights are), so with the floor's
// lights down they'd be the only things still lit. While a draft dims the floor these glow as dim as it,
// each on a copy of its material (the bulbs share theirs with every other lamp in the building), and
// they're given their own materials back the moment the floor's lights are all the way up again.

import * as THREE from 'three';
import { LOFT } from '../../../shared/layout';

type Lit = THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>;

/** Is `m` a glowing bulb (an emissive toon material that isn't black)? */
function glows(o: THREE.Object3D): o is Lit {
  const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
  return !!(o as THREE.Mesh).isMesh && !!m && !Array.isArray(m) && !!m.isMeshToonMaterial && !!m.emissive && m.emissive.getHex() !== 0;
}

export class LoftLights {
  private dimmed: { mesh: Lit; own: THREE.MeshToonMaterial; copy: THREE.MeshToonMaterial; glow: THREE.Color }[] | null = null;

  /** `root` is the office floor; `skip` is what isn't the loft's (the draft's own lamp). */
  constructor(
    private root: THREE.Object3D,
    private skip: THREE.Object3D,
  ) {}

  /** How much of their glow is left: 1 gives them back their own materials. */
  set(level: number) {
    if (level >= 1) return this.restore();
    if (!this.dimmed) this.dimmed = this.find();
    for (const d of this.dimmed) d.copy.emissive.copy(d.glow).multiplyScalar(level);
  }

  restore() {
    if (!this.dimmed) return;
    for (const d of this.dimmed) {
      d.mesh.material = d.own;
      d.copy.dispose();
    }
    this.dimmed = null;
  }

  /** The bulbs up in the loft and the meeting room under it. */
  private find() {
    const out: NonNullable<LoftLights['dimmed']> = [];
    const at = new THREE.Vector3();
    this.root.updateWorldMatrix(true, true);
    this.root.traverse((o) => {
      if (!glows(o) || isIn(this.skip, o)) return;
      o.getWorldPosition(at);
      if (at.x < LOFT.minX || at.x > LOFT.maxX || at.z < LOFT.minZ || at.z > LOFT.maxZ) return;
      const own = o.material;
      const copy = own.clone();
      o.material = copy;
      out.push({ mesh: o, own, copy, glow: own.emissive.clone() });
    });
    return out;
  }
}

function isIn(root: THREE.Object3D, o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}
