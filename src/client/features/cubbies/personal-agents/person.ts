import * as THREE from 'three';
import type { Look } from '../../../../shared/avatar';
import { outfitFor, personalName, type OwnerColor, type PersonalRole } from '../../../../shared/personal-agents/appearance';
import { Person } from '../../../world/character/person';
import { PersonalNameplate } from './nameplate';
import { OwnerRing } from './ring';
import { papers } from '../../../world/character/worker-props';
import { mesh, toon } from '../../../world/toon';

/** Personal outfits hang from the existing Person rig, just like its holiday outfit. */
export class PersonalPerson extends Person {
  private uniform: THREE.Object3D[] = [];
  private plate = new PersonalNameplate(2.02);
  readonly ring = new OwnerRing(this.root, 0.9);
  private title = '';
  private ownerColor = '#1e40c8';
  private appearance = '';
  private statusText = '';

  constructor(name: string, color: string, look: Look) {
    super(name, color, look);
    this.rig.torso.name = 'owner-garment';
    this.root.add(this.plate.sprite);
  }

  // The base constructor calls this: personal agents use only their combined plate.
  override setLabel(_name: string, _muted: boolean | null) {}
  override showLabel(show: boolean) { this.plate.sprite.visible = show; }

  setUniform(owner: string, project: string, role: PersonalRole, color: OwnerColor) {
    const key = JSON.stringify([owner, project, role, color]);
    if (key === this.appearance) return;
    this.appearance = key;
    for (const part of this.uniform) {
      part.removeFromParent();
      part.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    this.uniform = [];
    const { top, accent, prop } = outfitFor(role, color);
    this.setColor(top);
    const cloth = toon(top), trim = toon(accent), cream = toon('#f4ecdf');
    const put = (parent: THREE.Object3D, part: THREE.Object3D, name: string) => {
      part.name = name; parent.add(part); this.uniform.push(part);
      part.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    };
    const band = mesh(new THREE.CylinderGeometry(0.268, 0.268, 0.075, 24), trim, 0, role === 'Product' ? 0.09 : -0.12, 0);
    put(this.rig.torso, band, 'owner-band');
    if (role === 'CEO') {
      put(this.rig.torso, mesh(new THREE.BoxGeometry(0.16, 0.28, 0.025), cream, 0, 0.12, 0.25), 'shirt-front');
      for (const side of [-1, 1]) {
        const lapel = mesh(new THREE.BoxGeometry(0.08, 0.28, 0.04), cloth, side * 0.1, 0.12, 0.27);
        lapel.rotation.z = side * -0.28; put(this.rig.torso, lapel, 'blazer-lapel');
      }
      put(this.rig.torso, mesh(new THREE.ConeGeometry(0.045, 0.23, 4), toon('#2b2d42'), 0, 0.09, 0.285), 'dark-tie');
    } else if (role === 'Marketing') {
      const hood = mesh(new THREE.TorusGeometry(0.24, 0.1, 10, 24), cloth, 0, 1.08, -0.12);
      hood.rotation.x = Math.PI / 2; put(this.rig.body, hood, 'hood');
      put(this.rig.torso, mesh(new THREE.BoxGeometry(0.24, 0.11, 0.04), trim, 0, -0.06, 0.25), 'hoodie-pocket');
      for (const x of [-0.065, 0.065]) put(this.rig.torso, mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.17, 6), cream, x, 0.16, 0.26), 'hoodie-cord');
    } else if (role === 'Design') {
      const beret = mesh(new THREE.SphereGeometry(0.34, 24, 12), cream, 0.04, 0.27, 0);
      beret.scale.set(1.1, 0.32, 1); beret.rotation.z = -0.18;
      put(this.rig.head, beret, 'owner-beret');
      put(this.rig.head, mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 8), cream, 0.03, 0.39, 0), 'beret-stem');
      put(this.rig.torso, mesh(new THREE.CylinderGeometry(0.265, 0.31, 0.35, 24), cloth, 0, -0.18, 0), 'smock');
      put(this.rig.torso, mesh(new THREE.CylinderGeometry(0.312, 0.312, 0.055, 24), trim, 0, -0.33, 0), 'smock-trim');
    }
    if (role === 'Product') put(this.rig.torso, mesh(new THREE.CylinderGeometry(0.268, 0.268, 0.11, 24), cream, 0, 0.08, 0), 'chest-band');
    if (prop) {
      const held = new THREE.Group();
      held.position.set(0, -0.34, 0.12);
      if (prop === 'clipboard') {
        held.add(mesh(new THREE.BoxGeometry(0.37, 0.47, 0.035), toon('#916b45'), 0, -0.12, 0));
        const paper = papers().group; paper.rotation.y = Math.PI; paper.position.set(0, 0.08, 0.035); held.add(paper);
      } else {
        const horn = mesh(new THREE.CylinderGeometry(0.17, 0.065, 0.3, 20), cream, 0, 0.02, 0.15);
        horn.rotation.x = Math.PI / 2;
        held.add(horn, mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 8), trim, 0, -0.09, 0.05));
        const mouth = mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.015, 20), toon('#303449'), 0, 0.02, 0.305);
        mouth.rotation.x = Math.PI / 2; held.add(mouth);
      }
      put(this.rig.armR, held, prop);
    }
    this.title = personalName(owner, project, role);
    this.ownerColor = color;
    this.ring.setColor(color);
    this.plate.set(this.title, this.statusText || 'Ready', color);
    this.root.userData.personal = { role, ownerColor: color, label: this.title };
  }

  /** The roster status, as the office's worker models report it ('offline' while the computer sleeps). */
  status: import('../../../../shared/protocol').WorkerStatus = 'starting';
  setStatus(status: import('../../../../shared/protocol').WorkerStatus) { this.status = status; }

  override setDoing(text: string | undefined) {
    this.statusText = text ?? '';
    this.plate.set(this.title, this.statusText, this.ownerColor);
  }

  override update(dt: number, t: number, moving = false, running = false) {
    super.update(dt, t, moving, running);
    this.ring.update();
  }
  dispose() { this.plate.dispose(); this.ring.dispose(); }
}
