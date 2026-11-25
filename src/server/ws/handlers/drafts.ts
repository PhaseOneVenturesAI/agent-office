import type { DraftsClientMsg } from '../../../shared/protocol/drafts.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { cubbiesChanged } from './cubbies.js';

export const draftsView: ViewPieces['drafts'] = (ctx, floor, c) =>
  ctx.drafts?.state(floor?.id, c.accountId, ctx.cubbies) ?? { enabled: false, canStart: false };
const last = new WeakMap<Client, string>();
export function draftsChanged(ctx: Ctx) {
  if (!ctx.drafts) return;
  for (const c of ctx.clients.values()) {
    const state = draftsView(ctx, ctx.floorOf(c), c), key = JSON.stringify(state);
    if (last.get(c) === key) continue;
    last.set(c, key); ctx.sendTo(c, { t: 'drafts', state });
  }
}
export const draftsHandlers = {
  'drafts.new'(ctx, c, msg) {
    try {
      const def = ctx.drafts.create(msg.name, c.accountId);
      const floor = ctx.openFloor(def);
      if (!floor) return ctx.warn(c, 'Draft saved, but its floor could not open. Check the office log');
      ctx.floorsChanged();
      ctx.sendTo(c, { t: 'drafts.made', floorId: floor.id });
      ctx.goToFloor(c, floor);
      draftsChanged(ctx);
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
  async 'drafts.kickoff'(ctx, c, msg) {
    const floor = ctx.floors.get(msg.floorId);
    try {
      if (!floor) throw Error('No such floor');
      const launched = await ctx.drafts.kickoff(msg.floorId, msg.confirm, c.accountId, ctx.cubbies);
      ctx.broadcast({ t: 'drafts.kicked', floorId: floor.id, name: launched.name, by: c.peer.name });
      ctx.toastAll(`${launched.name} is open.`);
      ctx.toFloor(floor, { t: 'gong', why: 'merged', by: c.peer.name });
      ctx.floorsChanged();
      cubbiesChanged(ctx); // Also publishes the draft/Design-book state.
    } catch (error) {
      ctx.sendTo(c, { t: 'drafts.kickoffFailed', floorId: msg.floorId, error: (error as Error).message });
    }
  },
  'drafts.feedback'(ctx, c, msg) {
    try {
      if (!ctx.drafts.owns(msg.floorId, c.accountId)) throw Error('No such floor');
      ctx.cubbies.feedback(msg.floorId, c.accountId!, msg);
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
} satisfies HandlerMap<DraftsClientMsg>;
