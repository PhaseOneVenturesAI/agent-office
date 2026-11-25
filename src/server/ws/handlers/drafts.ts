import type { DraftsClientMsg } from '../../../shared/protocol/drafts.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';

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
} satisfies HandlerMap<DraftsClientMsg>;
