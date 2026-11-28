import { projectLive } from './project-live';
import { needsLabel } from '../../../shared/protocol/hq';
import type { Ctx } from '../../core/context';
import type { Cubbies } from '../cubbies';
import { store } from '../../state';
import { hintTitle, key, onE } from '../../core/hint';
import { HQLeadWorld, type LeadTarget } from './lead-world';
import { openHQLead } from './lead-chat';

declare module '../../world/types' {
  interface InteractKinds {
    hqlead: true;
  }
}
export interface HQLeadDeps { cubbies(): Cubbies; ride(id: string): void }
/** HQ and project floors each show the same lead identity. */
export function wireHQLeads(ctx: Ctx, deps: HQLeadDeps) {
  const world = new HQLeadWorld(); ctx.scene.add(world.group);
  let hqKey = '';
  const current = (id: string) => store.leadTalk?.leads.find(l => l.id === id) ?? store.hq?.leads?.find(l => l.id === id)
    ?? store.cubbies.cubbies.flatMap(c => [c.hqLead?.lead, ...c.hqLead?.departments ?? []]).find(l => l?.id === id);
  const allowed = (it: LeadTarget) => store.hq?.floorId === store.floor || (it.lead.mac ? !!store.leadTalk?.mine : !!it.lead.cubby?.mine);
  ctx.usables.add({ usable: () => world.group.visible ? world.targets : [], pickable: () => world.group });
  ctx.interactions.define('hqlead', {
    reach: 3.5,
    hint: it => ({ k: `hq-lead-${(it as LeadTarget).lead.id}-${allowed(it as LeadTarget)}`, parts: [hintTitle([(it as LeadTarget).lead.title, needsLabel((it as LeadTarget).lead.needs), (it as LeadTarget).lead.needs?.items[0]].filter(Boolean).join(' · ')), ...(allowed(it as LeadTarget) ? [key('E', 'Talk')] : [])] }),
    use: onE(it => {
      if (!allowed(it as LeadTarget)) return;
      const lead = current((it as LeadTarget).lead.id);
      if (lead) openHQLead(ctx, lead, () => current(lead.id));
    }),
  });
  projectLive(ctx, deps);
  ctx.ticks.add('world', f => {
    world.group.visible = ctx.inOffice() && !ctx.upTop() && !!store.hq && store.hq.floorId === store.floor;
    const next = world.group.visible ? JSON.stringify(store.hq) : '';
    if (next !== hqKey) { hqKey = next; if (next) world.set(store.hq!); else world.clear(); }
    if (world.group.visible) world.update(f.dt, f.t, ctx.camera);
  });
}
