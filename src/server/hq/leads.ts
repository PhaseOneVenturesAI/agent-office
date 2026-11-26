import { HQ_FURNISHED_PROJECTS } from '../../shared/protocol/hq.js';
import type { HQLead, HQProject, LeadWhere } from '../../shared/protocol/hq.js';
import type { CubbyInfo, CubbiesState } from '../../shared/protocol/cubbies.js';
import type { Pitch } from '../../shared/protocol/pitch.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { watcherInterior } from '../cubbies/sharing.js';

export interface LeadSource { floorId: string; projects: HQProject[]; cubby: CubbyInfo; pitch?: Pitch }
/** The single location decision point. Step 4 can supply presence here; nothing selects project yet. */
export function leadWhere(pitch?: Pitch): LeadWhere {
  return pitch?.status === 'ready' && pitch.pieces.some(p => !p.stamp) ? 'pitch' : 'hq';
}
export function projectFloor(project: HQProject, sourceFloor: string | undefined, floors: { id: string; repo?: string }[]) {
  if (project.own && sourceFloor && floors.some(f => f.id === sourceFloor)) return sourceFloor;
  return project.repo ? floors.find(f => f.repo?.toLowerCase() === project.repo!.toLowerCase())?.id : undefined;
}
const sameProject = (a: HQProject, b: HQProject) => a.repo && b.repo ? a.repo.toLowerCase() === b.repo.toLowerCase() : a.name === b.name;
export function projectLeads(projects: HQProject[], sources: LeadSource[], floors: { id: string; repo?: string }[], mine: boolean): HQLead[] {
  const connected = new Set<string>();
  return projects.flatMap((p, projectIndex) => {
    const floorId = projectFloor(p, sources[0]?.floorId, floors);
    // A repo link alone never claims an unrelated cubby's conversation.
    const source = sources.find(s => !connected.has(s.cubby.id) && s.floorId === floorId && s.projects.some(q => q.own && sameProject(p, q)));
    const info = source?.cubby;
    if (info && p.hasMainLead) connected.add(info.id);
    const cubby = info && (mine ? info : { id: info.id, slot: info.slot, ownerName: info.ownerName, ownerColor: info.ownerColor,
      lamp: info.lamp, working: info.working, mine: false, watching: true as const,
      ...(info.interior ? { interior: watcherInterior(info.interior) } : {}) });
    const identity = p.repo?.toLowerCase() ?? p.name;
    const base = { project: p.name, projectIndex, ...(floorId ? { floorId } : {}), computer: info?.interior?.computerName ?? sources[0]?.cubby.interior?.computerName ?? 'your computer' };
    return [
      ...(p.hasMainLead ? [{ ...base, id: info ? `cubby:${info.id}` : `project:${identity}:ceo`, role: 'CEO', title: 'Main lead',
        where: leadWhere(source?.pitch), needsYou: !!info?.interior?.needsYou.length, ...(cubby ? { cubby } : {}) }] : []),
      ...p.departmentLeads.map((d, departmentIndex) => ({ ...base, id: `project:${identity}:department:${d.department}:${d.title}`, departmentIndex,
        role: d.department, title: d.title, where: 'hq' as const, needsYou: false })),
    ];
  });
}
export function hqAccess(ctx: Ctx, c: Client) {
  if (!ctx.hq?.enabled || c.out || !c.accountId) return;
  const floor = [...ctx.floors.values()].find(f => ctx.hq.is(f.id));
  if (!floor || !ctx.hq.visible(floor.id, c.accountId)) return;
  const owner = [...ctx.cubbies.records.rows.values()].find(r => ctx.hq.owns(r.owner))?.owner;
  if (owner) return { owner, floorId: floor.id, mine: ctx.hq.owns(c.accountId) };
}
export function leadsFor(ctx: Ctx, owner: string, mine: boolean) {
  const sources = ctx.cubbies.hqSources(owner);
  return projectLeads(ctx.cubbies.hqProjects(owner) ?? [], sources, [...ctx.floors.values()].map(f => ({ id: f.id, repo: f.def.repo })), mine).filter(l => l.projectIndex < HQ_FURNISHED_PROJECTS);
}
/** Add only location metadata on a project floor; never grant cubby-interior admission. */
export function withHQLeads(ctx: Ctx, c: Client, state: CubbiesState): CubbiesState {
  const access = hqAccess(ctx, c);
  if (!access || !state.enabled) return state;
  const leads = leadsFor(ctx, access.owner, access.mine);
  return { ...state, cubbies: state.cubbies.map(info => {
    const lead = leads.find(l => l.cubby?.id === info.id && l.floorId === state.floorId);
    if (!lead) return info;
    // The read-only thread in location metadata does not open the room or grant sharing admission.
    return { ...info, hqLead: { hqFloorId: access.floorId, lead } };
  }) };
}
/** Cross-floor chat keeps the original cubby binding and the existing owner-signed send. */
export function hqChat(ctx: Ctx, c: Client, msg: { id: string } & import('../../shared/protocol/cubbies.js').CubbyOwnerMessage) {
  const access = hqAccess(ctx, c);
  if (!access?.mine || !ctx.hq.is(ctx.floorOf(c)?.id)) throw Error('Only the cubby owner can talk to its lead');
  const lead = leadsFor(ctx, access.owner, true).find(l => l.cubby?.id === msg.id);
  if (!lead?.floorId) throw Error('No connected HQ lead');
  ctx.cubbies.chat(lead.floorId, c.accountId!, msg.id, msg);
}
