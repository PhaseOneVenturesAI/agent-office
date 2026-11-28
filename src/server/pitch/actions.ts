import { selectPitchProject } from '../hq/pitch.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { PitchAction } from '../../shared/protocol/pitch.js';
import { DEPARTMENTS, kickoffText, sameDepartment } from '../../shared/pitch/flow.js';
import { leadsFor } from '../hq/leads.js';
function access(ctx: Ctx, c: Client, project: string) {
  if (c.out || !ctx.hq?.owns(c.accountId)) throw Error('Only the HQ owner can direct a pitch');
  const owner = c.accountId!, mac = ctx.hq.mac;
  const p = mac?.projects(owner)?.find(p => p.name === project), floor = ctx.floorOf(c);
  if (!p || !mac?.freshest(owner)) throw Error('Your Mac link is offline or this project is unavailable');
  if (!ctx.hq.is(floor?.id) && !(p.repo ? p.repo.toLowerCase() === floor?.def.repo?.toLowerCase() : p.name === floor?.def.name)) throw Error('Open this project floor or HQ first');
  return { owner, mac, p };
}
export function startPitch(ctx: Ctx, c: Client, project: string, department: number) {
  const { owner, mac, p } = access(ctx, c, project);
  const d = Number.isInteger(department) && p.departmentLeads[department];
  if (!d || !DEPARTMENTS.some(name => sameDepartment(name, d.department))) throw Error('Ask your project lead to add this department lead');
  const lead = leadsFor(ctx, owner, true).find(l => l.mac && l.project === project && l.departmentIndex === department);
  if (!lead) throw Error('Department lead unavailable');
  const line = mac.talk.submit(owner, lead, kickoffText(project, d.department), ctx.accounts.get(owner)!.name);
  if (line.state === 'failed') throw Error(line.error);
  selectPitchProject(ctx, c, project);
  ctx.sendTo(c, { t: 'pitch.started', project, department: d.department, leadId: lead.id });
}
export function pitchAction(ctx: Ctx, c: Client, msg: PitchAction) {
  const { owner, mac } = access(ctx, c, msg.project);
  if (!['pick', 'ok', 'decline'].includes(msg.action)) throw Error('Unknown pitch action');
  const view = mac.pitchViews(owner).find(v => v.project === msg.project && v.pitch.version === msg.version);
  if (!view) throw Error('Choose the current pitch');
  const lead = leadsFor(ctx, owner, true).find(l => l.mac && l.project === msg.project && l.departmentIndex !== undefined && sameDepartment(l.role, view.pitch.department));
  if (!lead) throw Error('This pitch has no registered department lead');
  mac.decisions.act(owner, msg.project, view.pitch, msg, text => {
    const line = mac.talk.submit(owner, lead, text, ctx.accounts.get(owner)!.name);
    if (line.state === 'failed') throw Error(line.error);
  });
}
