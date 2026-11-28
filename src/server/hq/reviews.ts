import { sameDepartment } from '../../shared/pitch/flow.js';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { DraftFeedbackMessage } from '../../shared/protocol/drafts.js';
import type { PitchVerdictClientMsg } from '../../shared/protocol/pitch.js';
import { cleanReview, type LeadReview } from '../../shared/protocol/lead-review.js';
import { leadsFor } from './leads.js';
function owner(ctx: Ctx, c: Client) {
  if (c.out || !ctx.hq?.owns(c.accountId)) throw Error('Only the HQ owner can give feedback or verdicts');
  return c.accountId!;
}
function submit(ctx: Ctx, c: Client, project: string, text: string, review: LeadReview, department?: string) {
  const account = owner(ctx, c), clean = cleanReview(review);
  if (!clean) throw Error('Choose a current card and write your review');
  const leads = leadsFor(ctx, account, true).filter(l => l.mac && l.project === project);
  const lead = (department && leads.find(l => l.departmentIndex !== undefined && sameDepartment(l.role, department))) || leads.find(l => l.departmentIndex === undefined);
  if (!lead || !ctx.hq.mac?.freshest(account)) throw Error('Your Mac link is offline or this project has no linked lead');
  return ctx.hq.mac.talk.submit(account, lead, text, ctx.accounts.get(account)!.name, clean);
}
export function studioFeedback(ctx: Ctx, c: Client, project: string, cardId: string, text: string, requestId: string = randomUUID()) {
  const account = owner(ctx, c);
  const row = ctx.hq.mac?.freshest(account)?.live.projects.find(p => p.project.name === project);
  const card = [...row?.draft?.ideas ?? [], ...row?.draft?.screens ?? []].find(c => c.id === cardId);
  if (!card) throw Error('Choose a current card and write your feedback');
  const version = 'status' in card ? ` v${('version' in card ? card.version : 1) ?? 1}` : '';
  return submit(ctx, c, project, `Feedback on ${version ? 'screen' : 'card'} ${card.title}${version} (${card.id}): ${text}`,
    { kind: 'draft', cardId, text, requestId, at: Date.now() });
}
export function draftFeedback(ctx: Ctx, c: Client, msg: DraftFeedbackMessage & { floorId: string }) {
  const account = owner(ctx, c);
  if (!ctx.drafts.owns(msg.floorId, account) && !ctx.hq.studio?.owns(msg.floorId, account)) throw Error('No such floor');
  const name = ctx.floors.get(msg.floorId)?.def.name;
  if (!name) throw Error('No such floor');
  return studioFeedback(ctx, c, name, msg.cardId, msg.text, msg.requestId);
}
export function pitchVerdict(ctx: Ctx, c: Client, msg: PitchVerdictClientMsg) {
  const account = owner(ctx, c), floor = ctx.floorOf(c);
  const view = ctx.hq.mac?.pitchViews(account).find(v => v.cubbyId === msg.cubbyId && v.floorId === msg.floorId);
  const project = view && ctx.hq.mac?.projects(account)?.find(p => p.name === view.project);
  const onProject = project && (project.repo ? floor?.def.repo?.toLowerCase() === project.repo.toLowerCase() : floor?.def.name === project.name);
  if (!view || (!ctx.hq.is(floor?.id) && !onProject) || view.pitch.version !== msg.version || !view.pitch.pieces.some(p => p.id === msg.pieceId)) throw Error('Choose the current pitch on its floor or HQ');
  return submit(ctx, c, view.project, `Pitch verdict on ${view.pitch.pieces.find(p => p.id === msg.pieceId)!.title} (${msg.version}): ${msg.verdict}${msg.note ? ` — ${msg.note}` : ''}`,
    { ...msg, kind: 'pitch', at: Date.now() }, view.pitch.department);
}

/** The same Mac publication and review controls on its repository floor. */
export function projectPitch(ctx: Ctx, c: Client) {
  if (c.out || !ctx.hq?.owns(c.accountId)) return;
  const floor = ctx.floorOf(c);
  const view = ctx.hq.mac?.pitchViews(c.accountId!).find(view => {
    const project = ctx.hq.mac?.projects(c.accountId!)?.find(p => p.name === view.project);
    return project?.repo ? project.repo.toLowerCase() === floor?.def.repo?.toLowerCase() : project?.name === floor?.def.name;
  });
  return view && { ...view, displayFloorId: floor!.id };
}
