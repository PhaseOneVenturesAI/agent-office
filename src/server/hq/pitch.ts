import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { ownerId, hqPitch } from './views.js';
const selected = new WeakMap<Client, number>();
export function selectedPitch(ctx: Ctx, c: Client, owner: string) {
  const views = ctx.hq.mac?.pitchViews(owner) ?? [];
  return views.find(p => p.projectIndex === selected.get(c)) ?? views[0];
}
export function choosePitch(ctx: Ctx, c: Client, projectIndex: number) {
  const floor = ctx.floorOf(c)?.id, owner = ownerId(ctx);
  if (c.out || !floor || !ctx.hq.is(floor) || !ctx.hq.visible(floor, c.accountId) || !owner ||
    !Number.isInteger(projectIndex) || !ctx.hq.mac?.pitchViews(owner).some(p => p.projectIndex === projectIndex)) throw Error('No published HQ pitch');
  selected.set(c, projectIndex);
  ctx.sendTo(c, { t: 'pitch', view: hqPitch(ctx, c) });
}
