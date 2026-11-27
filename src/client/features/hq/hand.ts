import * as THREE from 'three';
import type { PersonalPerson } from '../cubbies/personal-agents/person';
/** Dim just the raised arm; restore shared cubby materials when this viewer loses the overlay. */
export class HandShade {
  private shaded = new Map<PersonalPerson, { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; copies: THREE.Material[] }[]>();
  set(person: PersonalPerson, dim: boolean) {
    if (this.shaded.has(person) === dim) return;
    if (!dim) {
      for (const { mesh, original, copies } of this.shaded.get(person) ?? []) { mesh.material = original; copies.forEach(m => m.dispose()); }
      this.shaded.delete(person); return;
    }
    const entries: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; copies: THREE.Material[] }[] = [];
    person.rig.armL.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const original = o.material, copies = (Array.isArray(original) ? original : [original]).map(m => { const c = m.clone(); c.transparent = true; c.opacity = .4; return c; });
      o.material = Array.isArray(original) ? copies : copies[0]; entries.push({ mesh: o, original, copies });
    });
    this.shaded.set(person, entries);
  }
  clear() { for (const p of this.shaded.keys()) this.set(p, false); }
}
