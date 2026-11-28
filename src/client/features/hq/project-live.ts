import { hqPlates } from './plates';
import { declutter } from '../cubbies/personal-agents/declutter';
import { HandShade } from './hand';
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { HQLeadDeps } from './leads';
import { store } from '../../state';
import { statusText, statusCard, type LeadTarget } from './lead-world';
import { PersonalPerson } from '../cubbies/personal-agents/person';
import { personalRole } from '../../../shared/personal-agents/appearance';
import { disposeTree, type Face } from '../cubbies/props';
import { furniture, toFloor } from '../cubbies/model';
import { needsLabel } from '../../../shared/protocol/hq';

/** Per-viewer project-floor overlay. Ordinary cubby state is never changed. */
export function projectLive(ctx: Ctx, deps: HQLeadDeps) {
  const group = new THREE.Group(); group.name = 'hq-project-live'; ctx.scene.add(group);
  const shade = new HandShade(), overridden = new Map<PersonalPerson, string>();
  let key = '', faces: Face[] = [], people: PersonalPerson[] = [], targets: LeadTarget[] = [];
  ctx.usables.add({ usable: () => group.visible ? targets : [], pickable: () => group });
  ctx.ticks.add('world', f => {
    group.visible = ctx.inOffice() && !ctx.upTop() && !store.hq && store.cubbies.enabled;
    const rooms = deps.cubbies().rooms();
    const next = group.visible ? JSON.stringify([store.floor, store.cubbies.cubbies, [...rooms.keys()]]) : '';
    if (key !== next) {
      key = next; faces.forEach(f => f.dispose()); people.forEach(p => p.dispose()); disposeTree(group); group.clear(); faces = []; people = []; targets = [];
      if (group.visible) for (const room of rooms.values()) {
        const info = store.cubbies.cubbies.find(c => c.slot === room.place.slot), lead = info?.hqLead?.lead;
        if (!lead) continue;
        const p = room.place;
        if (lead.needsYou) {
          const card = statusCard(lead, lead.needs ? needsLabel(lead.needs) : 'Needs you', true);
          const at = toFloor(p, 0, p.depth / 2 + .16);
          card.mesh.position.set(at.x, (p.y ?? 0) + 2.15, at.z); card.mesh.rotation.y = p.rotY;
          const target: LeadTarget = { kind: 'hqlead', lead, x: at.x, z: at.z, radius: 1.2 };
          card.mesh.userData.interact = target; targets.push(target); faces.push(card); group.add(card.mesh);
          const local = furniture(p.width, p.depth).lead, spot = toFloor(p, local.x, local.z);
          const glow = new THREE.Mesh(new THREE.CircleGeometry(.85, 32), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: lead.needs?.stale ? .08 : .22, depthWrite: false }));
          glow.name = 'hq-project-needs-glow'; glow.rotation.x = -Math.PI / 2; glow.position.set(spot.x, (p.y ?? 0) + .04, spot.z); group.add(glow);
        }
        // Department leads have no independent cubby chat. Their project bodies remain in the same room.
        for (const d of info?.hqLead?.departments ?? []) {
          if (!info?.interior) continue;
          const model = new PersonalPerson(d.title, info.ownerColor ?? '#5b3cc4', info.interior.look);
          model.setUniform(info.ownerName, d.project, personalRole({ department: d.role }), info.ownerColor ?? '#5b3cc4', d.role); model.setDoing(d.role);
          // Standing spaces between existing cubby furniture; never move or replace its helpers.
          const spots = [[-.65, -.9], [-1.7, 0], [-1.25, .85], [.9, 0], [1.75, .15], [.9, 1.15], [-.7, -1.6], [.1, -.9]];
          const [x, z] = spots[d.departmentIndex!];
          const at = toFloor(p, x * p.width / 4.5, z * p.depth / 4);
          model.root.position.set(at.x, p.y ?? 0, at.z); model.root.rotation.y = p.rotY; model.root.name = `hq-project-body-${d.id}`;
          const target: LeadTarget = { kind: 'hqlead', lead: d, x: at.x, z: at.z, radius: 1.2 }; model.root.userData.interact = target; targets.push(target);
          people.push(model); group.add(model.root);
        }
      }
    }
    const active = new Set<PersonalPerson>();
    for (const room of group.visible ? rooms.values() : []) {
      const lead = store.cubbies.cubbies.find(c => c.slot === room.place.slot)?.hqLead?.lead, model = room.leadBody();
      if (!lead || !model) continue;
      active.add(model);
      if (!overridden.has(model)) overridden.set(model, model.root.getObjectByName('personal-nameplate')?.userData.lines?.[1] ?? '');
      shade.set(model, lead.needsYou && !!lead.needs?.stale);
      model.root.userData.handRaised = lead.needsYou;
      model.setDoing(statusText(lead));
      if (lead.needsYou) {
        model.rig.armL.rotation.z = -2.5; model.rig.armL.rotation.x = -.25;
      }
    }
    for (const [model, text] of overridden) if (!active.has(model)) { shade.set(model, false); model.setDoing(text); model.root.userData.handRaised = false; overridden.delete(model); }
    if (group.visible) {
      people.forEach(p => p.update(f.dt, f.t));
      const roots: THREE.Object3D[] = people.map(p => p.root);
      for (const room of rooms.values()) if (store.cubbies.cubbies.find(c => c.slot === room.place.slot)?.hqLead) {
        room.group.traverseVisible(o => { if (o.children.some(c => c.name === 'personal-nameplate')) roots.push(o); });
      }
      declutter(hqPlates(roots, ctx.camera), roots, ctx.camera);
    }
  });
}
