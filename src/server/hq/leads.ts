import { hqProjects, hqSources } from './sources.js';
import { liveWorkers, sameProject } from './live.js';
import { HQ_FURNISHED_PROJECTS, visibleNeeds } from '../../shared/protocol/hq.js';
import { messageLeads } from './messages.js';
import type { HQLead, HQProject, LeadWhere } from '../../shared/protocol/hq.js';
import type { CubbyInfo, CubbiesState } from '../../shared/protocol/cubbies.js';
import type { Pitch } from '../../shared/protocol/pitch.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { watcherInterior } from '../cubbies/sharing.js';

export type LeadSource = { floorId: string; projects: HQProject[]; pitch?: Pitch } & (
  { mac: true; agents: import('../../shared/protocol/cubbies.js').CubbyAgent[]; computerName: string; observedAt: number }
  | { mac?: false; agents?: import('../../shared/protocol/cubbies.js').CubbyAgent[]; cubby: CubbyInfo });
const sourceComputer = (source?: LeadSource) => source?.mac ? source.computerName : source?.cubby.interior?.computerName;

/** The single location decision point: a ready pitch wins over verified linked presence. */
export function leadWhere(pitch?: Pitch, linked = false, workingHere = false): LeadWhere {
  return pitch?.status === 'ready' && pitch.pieces.some(p => !p.stamp) ? 'pitch' : linked && workingHere ? 'project' : 'hq';
}
export function projectFloor(project: HQProject, sourceFloor: string | undefined, floors: { id: string; repo?: string; name?: string }[]) {
  if (project.own && sourceFloor && floors.some(f => f.id === sourceFloor)) return sourceFloor;
  return floors.find(f => (project.repo && f.repo?.toLowerCase() === project.repo.toLowerCase()) || f.name?.toLowerCase() === project.name.toLowerCase())?.id;
}
export function projectLeads(projects: HQProject[], sources: LeadSource[], floors: { id: string; repo?: string; name?: string }[], mine: boolean): HQLead[] {
  const connected = new Set<string>();
  return projects.flatMap((p, projectIndex) => {
    const floorId = projectFloor(p, sources[0]?.floorId, floors);
    // A repo link alone never claims an unrelated cubby's conversation.
    const source = sources.find(s => s.mac && s.projects.some(q => sameProject(p, q))) ?? sources.find(s => !s.mac && !connected.has(s.cubby.id) && s.floorId === floorId && s.projects.some(q => q.own && sameProject(p, q)));
    const info = source?.mac ? undefined : source?.cubby;
    const registered = source?.projects.find(q => q.own && sameProject(p, q)) ?? p;
    const working = (id?: string) => !!id && liveWorkers(source).some(a => a.lead === id);
    const needs = visibleNeeds(p.needs, mine);
    if (info && p.hasMainLead) connected.add(info.id);
    const cubby = info && (mine ? info : { id: info.id, slot: info.slot, ownerName: info.ownerName, ownerColor: info.ownerColor,
      lamp: info.lamp, working: info.working, mine: false, watching: true as const,
      ...(info.interior ? { interior: { ...watcherInterior(info.interior), needsYou: [] } } : {}) });
    const identity = p.repo?.toLowerCase() ?? p.name;
    const base = { ...(source?.mac ? { mac: true, working: liveWorkers(source).filter(a => !p.departmentLeads.some(d => !!d.lead && d.lead === a.lead)).length } : {}), project: p.name, projectIndex, ...(floorId ? { floorId } : {}), computer: sourceComputer(source) ?? sourceComputer(sources[0]) ?? 'your computer' };
    return [
      ...(p.hasMainLead ? [{ ...base, id: info ? `cubby:${info.id}` : `project:${identity}:ceo`, role: 'CEO', title: 'Main lead', ...(source?.mac ? { leadStatus: p.leadStatus ?? { status: 'off' as const, updatedAt: source.observedAt } } : {}),
        where: source?.mac ? 'hq' as const : leadWhere(source?.pitch, !source?.mac && !!source && !!floorId, working(registered.lead)), needsYou: !!info?.interior?.needsYou.length || (needs?.open ?? 0) > 0, ...(needs ? { needs } : {}), ...(cubby ? { cubby } : {}) }] : []),
      ...p.departmentLeads.map((d, departmentIndex) => ({ ...base, id: `project:${identity}:department:${d.department}:${d.title}`, departmentIndex,
        role: d.department, title: d.title, ...(source?.mac ? { leadStatus: d.leadStatus ?? { status: 'off' as const, updatedAt: source.observedAt } } : {}), ...(source?.mac ? { working: liveWorkers(source).filter(a => !!d.lead && a.lead === d.lead).length } : {}), where: leadWhere(undefined, !source?.mac && !!source && !!floorId, working(registered.departmentLeads.find(q => q.department === d.department && q.title === d.title)?.lead)), needsYou: false })),
    ];
  });
}
export function hqAccess(ctx: Ctx, c: Client) {
  if (!ctx.hq?.enabled || c.out || !c.accountId) return;
  const floor = [...ctx.floors.values()].find(f => ctx.hq.is(f.id));
  if (!floor || !ctx.hq.visible(floor.id, c.accountId)) return;
  const owner = ctx.hq.mac?.owner() ?? [...ctx.cubbies.records.rows.values()].find(r => ctx.hq.owns(r.owner))?.owner;
  if (owner) return { owner, floorId: floor.id, mine: ctx.hq.owns(c.accountId) };
}
export function leadsFor(ctx: Ctx, owner: string, mine: boolean) {
  const remembered = !ctx.hq.mac?.sources(owner) ? ctx.hq.mac?.rememberedSources(owner) : undefined;
  const sources = remembered ?? hqSources(ctx, owner);
  const leads = projectLeads(remembered?.flatMap(s => s.projects) ?? hqProjects(ctx, owner), sources, [...ctx.floors.values()].map(f => ({ id: f.id, repo: f.def.repo, name: f.def.name })), mine);
  if (ctx.hq.mac?.owner()) leads.unshift({ id: 'cofounder', mac: true, project: 'HQ', projectIndex: -1, role: 'Chief of staff', title: 'Cofounder', computer: 'your Mac', where: 'hq', needsYou: false, leadStatus: ctx.hq.mac.cofounder(owner) ?? { status: 'unknown', updatedAt: 0 } });
  return leads.filter(l => l.mac || l.projectIndex < HQ_FURNISHED_PROJECTS).map(l => ({ ...l, ...(mine && l.mac ? { conversation: ctx.hq.mac?.talk.view(owner, l.id, owner) } : {}) }));
}
/** Add only location metadata on a project floor; never grant cubby-interior admission. */
export function withHQLeads(ctx: Ctx, c: Client, state: CubbiesState): CubbiesState {
  const access = hqAccess(ctx, c);
  if (!access || !state.enabled) return state;
  const leads = messageLeads(ctx, c, access.owner, leadsFor(ctx, access.owner, access.mine), false);
  return { ...state, cubbies: state.cubbies.map(info => {
    const lead = leads.find(l => l.cubby?.id === info.id && l.floorId === state.floorId);
    if (!lead) return info;
    // The read-only thread in location metadata does not open the room or grant sharing admission.
    return { ...info, hqLead: { hqFloorId: access.floorId, lead, departments: leads.filter(l => l.projectIndex === lead.projectIndex && l.departmentIndex !== undefined) } };
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
