import { LiveWorkWorld } from './live-work';
import * as THREE from 'three';
import { HQ_FURNISHED_PROJECTS } from '../../../shared/protocol/hq';
import type { HQView } from '../../../shared/protocol/hq';
import { PersonalHelper } from '../cubbies/personal-agents/helper';
import { textPlane } from '../../world/toon';
import { deskSpot } from './lead-world';

export class HQHelpers {
  readonly models: PersonalHelper[] = [];
  private live = new LiveWorkWorld();
  get roots() { return [...this.models.map(m => m.root), ...this.live.roots]; }
  update(dt: number, t: number) { this.models.forEach(m => m.update(dt, t)); this.live.update(dt, t); }
  clear() { this.live.clear(); this.models.forEach(m => m.dispose()); this.models.length = 0; }
  set(view: HQView, group: THREE.Group) {
    const seen = new Set<string>();
    for (const lead of view.leads ?? []) {
      if (lead.projectIndex >= HQ_FURNISHED_PROJECTS) continue;
      if (lead.helpers) { this.live.add(lead, view.ownerColor, group, deskSpot(lead)); continue; }
      const workers = (view.projects[lead.projectIndex]?.workers ?? []).filter(w => w.departmentIndex === lead.departmentIndex && !seen.has(w.id));
      workers.forEach(w => seen.add(w.id));
      const spot = deskSpot(lead), department = lead.departmentIndex !== undefined;
      workers.slice(0, 3).forEach((w, i) => {
        const model = new PersonalHelper(w.provider);
        model.dress(w.provider, w.title, view.ownerColor); model.setStatus('working', false);
        const plate = model.root.getObjectByName('personal-nameplate') as THREE.Sprite;
        plate.material.depthTest = true; plate.scale.multiplyScalar(.8);
        model.root.name = `hq-helper-${w.id}`; model.root.userData.worker = w; model.root.userData.desk = lead.id;
        model.root.scale.setScalar(department ? .55 : .7);
        // Department helpers stand behind their lead; CEO helpers flank the desk, clear of its card.
        const [dx, dz] = department ? [(i - 1) * .55, -.65] : [[-1.7, .4], [1.7, .4], [1.7, 1.15]][i];
        model.root.position.set(spot.x + dx, 0, spot.z + dz);
        group.add(model.root); this.models.push(model);
      });
      if (workers.length > 3) {
        const label = textPlane(`+${workers.length - 3}`, { bg: '#fff7e9', color: '#292638', size: 32 });
        label.name = 'hq-helper-overflow'; label.scale.setScalar(.5); label.position.set(spot.x + (department ? .8 : 1.7), .45, spot.z + (department ? -.65 : 1.8)); group.add(label);
      }
    }
  }
}
