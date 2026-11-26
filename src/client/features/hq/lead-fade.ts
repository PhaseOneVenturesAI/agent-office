import * as THREE from 'three';

/** A short arrival fade, with temporary materials so shared personal-agent colours never change. */
export class LeadFade {
  private elapsed = 0;
  private meshes: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
  private copies = new Map<THREE.Material, THREE.Material>();
  constructor(root: THREE.Object3D) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      this.meshes.push({ mesh: o, material: o.material });
      const copy = (m: THREE.Material) => {
        let c = this.copies.get(m);
        if (!c) { c = m.clone(); c.transparent = true; c.depthWrite = false; c.opacity = 0; this.copies.set(m, c); }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
    });
  }
  update(dt: number) {
    this.elapsed += dt;
    const opacity = Math.min(1, this.elapsed / .22);
    for (const [original, copy] of this.copies) copy.opacity = original.opacity * opacity;
    if (opacity === 1) this.finish();
  }
  finish() {
    for (const { mesh, material } of this.meshes) mesh.material = material;
    this.meshes = [];
    for (const copy of this.copies.values()) copy.dispose();
    this.copies.clear();
  }
}
