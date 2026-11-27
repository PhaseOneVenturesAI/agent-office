import * as THREE from 'three';
import type { HQView } from '../../../shared/protocol/hq';
import { PersonalHelper } from '../cubbies/personal-agents/helper';
import { textPlane } from '../../world/toon';
import { deskSpot } from './lead-world';

export class HQHelpers {
  readonly models: PersonalHelper[] = [];
  clear() { this.models.forEach(m => m.dispose()); this.models.length = 0; }
  set(view: HQView, group: THREE.Group) {
    const seen = new Set<string>();
    for (const lead of view.leads ?? []) {
      const workers = (view.projects[lead.projectIndex]?.workers ?? []).filter(w => w.departmentIndex === lead.departmentIndex && !seen.has(w.id));
      workers.forEach(w => seen.add(w.id));
      const spot = deskSpot(lead), department = lead.departmentIndex !== undefined;
      workers.slice(0, 3).forEach((w, i) => {
        const model = new PersonalHelper(w.provider);
        model.dress(w.provider, w.title, view.ownerColor); model.setStatus('working', false);
        (model.root.getObjectByName('personal-nameplate') as THREE.Sprite).material.depthTest = true;
        model.root.name = `hq-helper-${w.id}`; model.root.userData.worker = w; model.root.userData.desk = lead.id;
        model.root.scale.setScalar(department ? .55 : .7);
        model.root.position.set(spot.x + (i - 1) * (department ? .42 : .68), 0, spot.z + (department ? 1.1 : 2));
        group.add(model.root); this.models.push(model);
      });
      if (workers.length > 3) {
        const label = textPlane(`+${workers.length - 3}`, { bg: '#fff7e9', color: '#292638', size: 32 });
        label.name = 'hq-helper-overflow'; label.scale.setScalar(.5); label.position.set(spot.x + 1, .9, spot.z + 2); group.add(label);
      }
    }
  }
}
