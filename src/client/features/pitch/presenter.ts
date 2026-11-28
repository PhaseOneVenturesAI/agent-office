import { disposeTree } from '../cubbies/props';
import { route } from '../../../shared/nav';
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { HQLead } from '../../../shared/protocol/hq';
import { ELEVATOR, ELEVATOR_FRONT } from '../../../shared/layout';
import { store } from '../../state';
import { PersonalPerson } from '../cubbies/personal-agents/person';
import { personalRole } from '../../../shared/personal-agents/appearance';
/** A presentation of the registered identity, never a new lead/session. */
export class PitchPresenter {
  private model?: PersonalPerson;
  private id?: string;
  private points: THREE.Vector3[] = [];
  private hidden: THREE.Object3D[] = [];
  private spot = new THREE.SpotLight('#ffd497', 0, 9, .55, .7);
  private target = new THREE.Object3D();
  private tour = 0;
  private lastStop = -1;
  constructor(private ctx: Ctx) { this.spot.name = 'pitch-follow-spotlight'; this.spot.target = this.target; ctx.scene.add(this.spot, this.target); }
  clear() {
    this.hidden.forEach(o => { o.visible = true; }); this.hidden = [];
    if (this.model) { this.model.dispose(); disposeTree(this.model.root); this.model.root.removeFromParent(); }
    this.model = undefined; this.id = undefined; this.spot.intensity = 0;
  }
  enter(lead: HQLead, walk: boolean) {
    if (lead.id === this.id && this.model && !walk) return;
    this.clear(); this.id = lead.id; this.tour = 0; this.lastStop = -1;
    const view = store.leadTalk ?? store.hq!;
    this.model = new PersonalPerson(lead.title, view.ownerColor, { skin: 0, hair: 0, style: 0 });
    this.model.setUniform(view.ownerName, lead.project, personalRole({ department: lead.role }), view.ownerColor, lead.role);
    this.model.root.name = 'pitch-presenter'; this.model.root.userData.leadId = lead.id;
    this.points = walk && !this.ctx.reduceMotion.matches ? route([ELEVATOR.x, ELEVATOR_FRONT + .5], [11.1, 10.5]).slice(1).map(([x,z]) => new THREE.Vector3(x,0,z)) : [];
    this.model.root.position.set(this.points.length ? ELEVATOR.x : 11.1, 0, this.points.length ? ELEVATOR_FRONT + .5 : 10.5);
    this.ctx.scene.add(this.model.root);
  }
  update(dt: number, t: number, ready: boolean) {
    const model = this.model; if (!model) return;
    this.hidden = this.hidden.filter(o => o.parent);
    for (const name of [`hq-body-${this.id}`, `project-body-${this.id}`]) {
      const original = this.ctx.scene.getObjectByName(name);
      if (original && original.visible) { original.visible = false; this.hidden.push(original); }
    }
    if (this.ctx.reduceMotion.matches) { this.points = []; model.root.position.set(11.1, 0, 10.5); }
    if (!this.points.length && ready && !this.ctx.reduceMotion.matches) {
      this.tour += dt;
      if (this.tour > 6) {
        const stops = [[14.2,9.2], [13.5,9.3], [10.7,11.8], [12,9.3]];
        const index = Math.floor(this.tour / 6) % 4;
        if (index !== this.lastStop) { const [x,z] = stops[index]; this.points = route([model.root.position.x, model.root.position.z], [x,z]).slice(1).map(([x,z]) => new THREE.Vector3(x,0,z)); this.lastStop = index; }
      }
    }
    const next = this.points[0];
    if (next) {
      const delta = next.clone().sub(model.root.position), distance = delta.length();
      model.root.rotation.y = Math.atan2(delta.x, delta.z);
      if (distance < dt * 3) { model.root.position.copy(next); this.points.shift(); } else model.root.position.addScaledVector(delta.normalize(), dt * 3);
    }
    model.root.userData.walking = !!next;
    model.setDoing(ready ? 'Ready to pitch' : next ? 'Walking to the pitch table' : 'Brief Q&A'); model.update(dt, t, !!next);
    this.target.position.copy(model.root.position).y = 1;
    this.spot.position.copy(model.root.position).add(new THREE.Vector3(0, 3.3, .4)); this.spot.intensity = ready ? 4 : 0;
  }
}
