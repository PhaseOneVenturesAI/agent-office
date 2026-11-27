import * as THREE from 'three';
import type { HQLead } from '../../../shared/protocol/hq';
import type { Ctx } from '../../core/context';
import type { Cubbies } from '../cubbies';
import { furniture, toFloor } from '../cubbies/model';
import { disposeTree, type Face } from '../cubbies/props';
import { MEETING_ROOM } from '../../../shared/layout';
import { HALL_PLACES } from '../../../shared/cubbyhall';
import { store } from '../../state';
import { closeAllModals } from '../../ui/dom';
import { hintTitle, key, onE } from '../../core/hint';
import { HQLeadWorld, bodySpot, statusCard, type LeadTarget } from './lead-world';
import { openHQLead } from './lead-chat';

declare module '../../world/types' {
  interface InteractKinds {
    hqlead: true;
  }
}
export interface HQLeadDeps { cubbies(): Cubbies; ride(id: string): void }
/** The cubby overlay lives here: the cubby module only exposes a body visibility seam. */
export function wireHQLeads(ctx: Ctx, deps: HQLeadDeps) {
  const world = new HQLeadWorld(), away = new THREE.Group();
  away.name = 'hq-away-cards'; const group = new THREE.Group(); group.name = 'hq-lead-layer'; group.add(world.group, away); ctx.scene.add(group);
  let hqKey = '', awayKey = '', faces: Face[] = [], cards: LeadTarget[] = [];
  let pending: { floor: string; lead: HQLead; toHQ: boolean; until: number } | undefined;
  const current = (id: string) => store.hq?.leads?.find(l => l.id === id) ?? store.cubbies.cubbies.find(c => c.hqLead?.lead.id === id)?.hqLead?.lead;
  const go = (lead: HQLead, hqFloor: string, toHQ: boolean) => {
    const floor = toHQ ? hqFloor : lead.floorId;
    if (!floor || !store.floors.some(f => f.id === floor)) return;
    closeAllModals();
    pending = { floor, lead, toHQ, until: performance.now() + 12_000 };
    if (floor !== store.floor) deps.ride(floor);
  };
  ctx.usables.add({ usable: () => [...(world.group.visible ? world.targets : []), ...(away.visible ? cards : [])], pickable: () => group });
  ctx.interactions.define('hqlead', {
    reach: 3.5,
    hint: it => ({ k: `hq-lead-${(it as LeadTarget).lead.id}`, parts: [hintTitle((it as LeadTarget).lead.title), key('E', 'Talk')] }),
    use: onE(it => {
      const target = it as LeadTarget, lead = current(target.lead.id);
      if (!lead) return;
      const hqFloor = store.hq?.floorId ?? store.cubbies.cubbies.find(c => c.hqLead?.lead.id === lead.id)?.hqLead?.hqFloorId;
      const onHQ = store.floor === hqFloor;
      // Desk cards lead to the pitch room; a pitch-room body offers the way back to its project door.
      const visit = hqFloor && lead.floorId ? () => go(lead, hqFloor, !onHQ || !!target.card) : undefined;
      openHQLead(ctx, lead, () => current(lead.id), visit);
    }),
  });
  ctx.ticks.add('world', f => {
    const active = ctx.inOffice() && !ctx.upTop();
    world.group.visible = active && !!store.hq && store.hq.floorId === store.floor;
    const nextHQ = world.group.visible ? JSON.stringify(store.hq) : '';
    if (nextHQ !== hqKey) { hqKey = nextHQ; if (nextHQ) world.set(store.hq!); else world.clear(); }
    away.visible = active && !world.group.visible && store.cubbies.enabled;
    const rooms = deps.cubbies().rooms();
    const nextAway = away.visible ? JSON.stringify([store.floor, store.cubbies.cubbies.map(c => [c.id, c.hqLead, !!c.interior]), [...rooms.values()].map(r => r.place)]) : '';
    if (nextAway !== awayKey) {
      awayKey = nextAway; faces.forEach(f => f.dispose()); faces = []; disposeTree(away); away.clear(); cards = [];
      for (const r of rooms.values()) {
        const info = store.cubbies.cubbies.find(c => c.slot === r.place.slot), lead = info?.hqLead?.lead;
        const absent = !!lead && lead.where !== 'project' && away.visible;
        r.setLeadPresent(!absent);
        if (!absent) continue;
        const text = lead.where === 'pitch' ? 'In the HQ pitch room' : 'At HQ';
        const p = r.place, local = furniture(p.width, p.depth).lead;
        // The body stands close to the side wall; keep the wider card entirely inside the room.
        const cardX = Math.max(-p.width / 2 + .95, Math.min(p.width / 2 - .95, local.x));
        const places = [{ x: 0, z: p.depth / 2 + .12, y: 2.62, small: true }, ...(info?.interior ? [{ ...local, x: cardX, y: 1.4, small: false }] : [])];
        for (const spot of places) {
          const at = toFloor(p, spot.x, spot.z), face = statusCard(lead, text, spot.small);
          face.mesh.position.set(at.x, (p.y ?? 0) + spot.y, at.z); face.mesh.rotation.y = p.rotY;
          const target: LeadTarget = { kind: 'hqlead', lead, card: true, x: at.x, z: at.z, radius: 1.2 };
          face.mesh.userData.interact = target; faces.push(face); cards.push(target); away.add(face.mesh);
        }
      }
    }
    // Cubby sync can rebuild its targets without changing the HQ metadata.
    if (away.visible) for (const r of rooms.values()) {
      const lead = store.cubbies.cubbies.find(c => c.slot === r.place.slot)?.hqLead?.lead;
      r.setLeadPresent(!lead || lead.where === 'project');
    }
    if (world.group.visible) world.update(f.dt, f.t, ctx.camera);
    if (pending && performance.now() > pending.until) pending = undefined;
    if (pending && pending.floor === store.floor && !ctx.trip()) {
      const lead = current(pending.lead.id) ?? pending.lead;
      let at: { x: number; z: number; rotY: number } | undefined;
      if (pending.toHQ && world.group.visible) {
        const spot = bodySpot(lead);
        const choices = [[0, 2.3], [-2.3, 0], [2.3, 0], [0, -2.3]];
        for (const [dx, dz] of choices) {
          const x = spot.x + dx, z = spot.z + dz;
          if (lead.where === 'pitch' && (x < MEETING_ROOM.minX + .4 || x > MEETING_ROOM.maxX - .4 || z < MEETING_ROOM.minZ + .4 || z > MEETING_ROOM.maxZ - .4)) continue;
          if (ctx.player.fits(x, z, 0)) { at = { x, z, rotY: Math.atan2(dx, dz) }; break; }
        }
      }
      else if (!pending.toHQ && store.cubbies.floorId === store.floor) {
        const place = rooms.get(lead.cubby?.slot ?? 0)?.place ?? HALL_PLACES[lead.cubby?.slot ?? 0];
        if (place) at = { ...toFloor(place, 0, place.depth / 2 + 1.3), rotY: place.rotY };
      }
      if (at) { ctx.player.pos.set(at.x, 0, at.z); ctx.player.vy = 0; ctx.player.camYaw = at.rotY; ctx.player.lookPitch = 0; ctx.player.updateCamera(true); pending = undefined; }
    }
  });
}
