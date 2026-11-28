import { projectPitch } from './reviews.js';
import { liveWorkProjects } from './live-work.js';
import { talkChanged } from './talk-views.js';
import { hqProjects, hqSources } from './sources.js';
import { selectedPitch } from './pitch.js';
import { liveProjects } from './live.js';
import { publicProjects } from '../../shared/protocol/hq.js';
import { messageLeads } from './messages.js';
import { leadsFor } from './leads.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { ViewPieces } from '../ws/handlers/types.js';
/** Select only the configured owner's records, regardless of their project floor. */
export function ownerId(ctx: Ctx) {
  return ctx.hq.mac?.owner() ?? [...ctx.cubbies.records.rows.values()].find(r => ctx.hq.owns(r.owner))?.owner;
}
export const hqView: ViewPieces['hq'] = (ctx, floor, c) => {
  if (!ctx.hq?.is(floor?.id) || c.out || !ctx.hq.visible(floor!.id, c.accountId)) return;
  const owner = ctx.hq.owns(c.accountId) ? c.accountId : ownerId(ctx);
  return { floorId: floor!.id, ownerName: ctx.hq.ownerName, mine: ctx.hq.owns(c.accountId),
    ...(owner && ctx.hq.owns(c.accountId) ? { mac: ctx.hq.mac?.status(owner) } : {}),
    ...(owner ? { pitches: ctx.hq.mac?.pitchViews(owner).map(p => ({ ...p, readOnly: !ctx.hq.owns(c.accountId) })) } : {}),
    ownerColor: ctx.cubbies.records.color(owner ?? ctx.hq.ownerName), projects: owner ? publicProjects(liveWorkProjects(liveProjects(hqProjects(ctx, owner), hqSources(ctx, owner)), leadsFor(ctx, owner, ctx.hq.owns(c.accountId))), ctx.hq.owns(c.accountId)) : [], leads: owner ? messageLeads(ctx, c, owner, leadsFor(ctx, owner, ctx.hq.owns(c.accountId)), true) : [] };
};
export function hqPitch(ctx: Ctx, c: Client) {
  const floor = ctx.floorOf(c);
  if (!ctx.hq?.is(floor?.id) || c.out || !ctx.hq.visible(floor!.id, c.accountId)) return;
  const owner = ownerId(ctx);
  if (!owner) return;
  const view = ctx.hq.mac?.freshest(owner) ? selectedPitch(ctx, c, owner) : ctx.cubbies.hqPitch(owner, ctx.hq.owns(c.accountId));
  if (!view) return;
  const { notice, ...publicView } = view;
  return { ...publicView, ...(ctx.hq.owns(c.accountId) && notice ? { notice } : {}), displayFloorId: floor!.id, readOnly: view.readOnly || !ctx.hq.owns(c.accountId) };
}
const last = new WeakMap<Client, string>();
export function hqChanged(ctx: Ctx) {
  if (!ctx.hq || !ctx.cubbies) return;
  talkChanged(ctx);
  for (const c of ctx.clients.values()) {
    const view = hqView(ctx, ctx.floorOf(c), c), key = JSON.stringify(view) ?? '';
    if (last.get(c) === key) continue;
    last.set(c, key);
    // No project payload to people on another floor, even the owner.
    if (view) ctx.sendTo(c, { t: 'hq', view });
  }
}
/** HTTP has no tab floor: require an authenticated live HQ occupant and the current HQ pitch. */
export function hqImage(ctx: Ctx, account: string, cubby: string, hash: string) {
  if (!ctx.hq) return;
  const c = [...ctx.clients.values()].find(c => c.accountId === account && !c.out && ctx.hq?.is(ctx.floorOf(c)?.id));
  if (!c) {
    const projectClient = [...ctx.clients.values()].find(c => c.accountId === account && projectPitch(ctx, c)?.cubbyId === cubby);
    return projectClient ? ctx.hq.mac?.pitches.image(cubby, hash) : undefined;
  }
  if (!ctx.hq.visible(ctx.floorOf(c)!.id, account)) return;
  const owner = ownerId(ctx);
  if (!owner) return;
  if (ctx.hq.mac?.pitchViews(owner).some(p => p.cubbyId === cubby)) return ctx.hq.mac.pitches.image(cubby, hash);
  if (hqPitch(ctx, c)?.cubbyId === cubby) return ctx.cubbies.pitchImage(cubby, owner, hash);
}
