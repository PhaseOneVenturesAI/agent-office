import { LiveWorkWorld } from './live-work';
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { HQLeadDeps } from './leads';
import type { LeadTarget } from './lead-world';
import { statusText } from './lead-world';
import { store } from '../../state';
import { PersonalPerson } from '../cubbies/personal-agents/person';
import { personalRole } from '../../../shared/personal-agents/appearance';
import { toFloor } from '../cubbies/model';
/** Linked leads have the same identity on HQ and their project; no away cards. */
export function talkFloor(ctx: Ctx, deps: HQLeadDeps) {
  const group = new THREE.Group(); group.name = 'linked-project-leads'; ctx.scene.add(group);
  const work = new LiveWorkWorld();
  let key = '', people: PersonalPerson[] = [], targets: LeadTarget[] = [];
  ctx.usables.add({ usable: () => group.visible ? targets : [], pickable: () => group });
  ctx.ticks.add('world', frame => {
    const view = store.leadTalk;
    const active = ctx.inOffice() && !ctx.upTop() && !store.floors.find(f => f.id === store.floor)?.hq;
    const leads = active ? view?.leads.filter(l => l.floorId === store.floor && l.id !== 'cofounder') ?? [] : [];
    const room = [...deps.cubbies().rooms().values()].find(r => {
      const info = store.cubbies.cubbies.find(c => c.slot === r.place.slot);
      return info?.ownerName === view?.ownerName;
    });
    if (room && leads.length) room.setLeadPresent(false);
    const next = JSON.stringify([leads, view?.ownerColor, room?.place]);
    group.visible = active;
    if (next !== key) {
      key = next; work.clear(); people.forEach(p => p.dispose()); people = []; targets = []; group.clear();
      leads.forEach((lead, i) => {
        const model = new PersonalPerson(lead.title, view!.ownerColor, { skin: 0, hair: 0, style: 0 });
        model.setUniform(view!.ownerName, lead.project, personalRole({ department: lead.role }, lead.role === 'CEO'), view!.ownerColor, lead.title);
        model.setDoing(statusText(lead));
        const at = room ? toFloor(room.place, -room.place.width / 2 + 1 + i % 3 * 1.3, -room.place.depth / 2 + 1.4 + Math.floor(i / 3) * 1.3) : { x: -5 + i % 4 * 1.6, z: 9 + Math.floor(i / 4) * 1.5 };
        model.root.position.set(at.x, room?.place.y ?? 0, at.z); model.root.name = `project-body-${lead.id}`;
        work.add(lead, view!.ownerColor, group, { ...at, y: room?.place.y }, 'project');
        const target: LeadTarget = { kind: 'hqlead', lead, x: at.x, z: at.z, radius: 1.2 };
        model.root.userData.interact = target; targets.push(target); people.push(model); group.add(model.root);
      });
      if (leads.some(l => l.helpers !== undefined || l.doing)) work.board(leads, group, room ? { ...toFloor(room.place, room.place.width / 2 - .6, 0), y: room.place.y } : { x: -7.5, z: 9 });
    }
    for (const p of people) p.update(frame.dt, frame.t);
    work.update(frame.dt, frame.t); work.declutter(people.map(p => p.root), ctx.camera);
  });
}
