// The hygiene watchdog (see server/hygiene.ts): the report for everyone, the cleanup for admins.
import type { HygieneClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can run the cleanup');
  return false;
};

export const hygieneHandlers = {
  'hygiene.get'(ctx, c) {
    ctx.sendTo(c, { t: 'hygiene', state: ctx.hygiene.state() });
    // First look of the run (or long after the last): scan without making the answer wait.
    if (!ctx.hygiene.state().scannedAt) void ctx.hygiene.scan();
  },
  'hygiene.scan'(ctx) {
    void ctx.hygiene.scan();
  },
  async 'hygiene.prune'(ctx, c, msg) {
    if (!ctx.floorVisible(str(msg.floor, 60), c)) return ctx.warn(c, 'No such floor');
    if (ctx.floors.get(str(msg.floor, 60))?.def.draft) return ctx.warn(c, 'Draft floors have no server workers to clean up');
    if (!admin(ctx, c)) return;
    ctx.toastAll(`🧹 ${await ctx.hygiene.prune(str(msg.floor, 60))}`);
  },
  async 'hygiene.home'(ctx, c, msg) {
    if (!ctx.floorVisible(str(msg.floor, 60), c)) return ctx.warn(c, 'No such floor');
    if (ctx.floors.get(str(msg.floor, 60))?.def.draft) return ctx.warn(c, 'Draft floors have no server workers to clean up');
    if (!admin(ctx, c)) return;
    const floor = ctx.floors.get(str(msg.floor, 60));
    const w = floor?.workers.get(str(msg.worker, 60));
    if (!floor || !w) return ctx.warn(c, 'That worker is gone already');
    ctx.toastFloor(floor, `🏠 ${c.peer.name} sent ${w.name} home (it had landed, per the hygiene report)`);
    const { note, error } = await floor.sendHome(w.id, undefined);
    if (note) ctx.toastFloor(floor, note);
    if (error) ctx.toastFloor(floor, error, 'warn');
    void ctx.hygiene.scan();
  },
} satisfies HandlerMap<HygieneClientMsg>;
