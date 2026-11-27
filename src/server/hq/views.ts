import { liveProjects } from './live.js';
import { publicProjects } from '../../shared/protocol/hq.js';
import { messageLeads } from './messages.js';
import { leadsFor } from './leads.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { ViewPieces } from '../ws/handlers/types.js';
/** Select only the configured owner's records, regardless of their project floor. */
export function ownerId(ctx: Ctx) {
  return [...ctx.cubbies.records.rows.values()].find(r => ctx.hq.owns(r.owner))?.owner;
}
export const hqView: ViewPieces['hq'] = (ctx, floor, c) => {
  if (!ctx.hq?.is(floor?.id) || c.out || !ctx.hq.visible(floor!.id, c.accountId)) return;
  const owner = ownerId(ctx);
  return { floorId: floor!.id, ownerName: ctx.hq.ownerName, mine: ctx.hq.owns(c.accountId),
    ownerColor: ctx.cubbies.records.color(owner ?? ctx.hq.ownerName), projects: owner ? publicProjects(liveProjects(ctx.cubbies.hqProjects(owner) ?? [], ctx.cubbies.hqSources(owner)), ctx.hq.owns(c.accountId)) : [], leads: owner ? messageLeads(ctx, c, owner, leadsFor(ctx, owner, ctx.hq.owns(c.accountId)), true) : [] };
};
export function hqPitch(ctx: Ctx, c: Client) {
  const floor = ctx.floorOf(c);
  if (!ctx.hq?.is(floor?.id) || c.out || !ctx.hq.visible(floor!.id, c.accountId)) return;
  const owner = ownerId(ctx);
  if (!owner) return;
  const view = ctx.cubbies.hqPitch(owner, ctx.hq.owns(c.accountId));
  if (!view) return;
  const { notice, ...publicView } = view;
  return { ...publicView, ...(ctx.hq.owns(c.accountId) && notice ? { notice } : {}), displayFloorId: floor!.id, readOnly: !ctx.hq.owns(c.accountId) };
}
const last = new WeakMap<Client, string>();
export function hqChanged(ctx: Ctx) {
  if (!ctx.hq || !ctx.cubbies) return;
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
  if (!c || hqPitch(ctx, c)?.cubbyId !== cubby) return;
  const owner = ownerId(ctx);
  return owner && ctx.cubbies.pitchImage(cubby, owner, hash);
}
