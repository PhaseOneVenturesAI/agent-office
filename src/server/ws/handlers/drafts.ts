import type { DraftsClientMsg } from '../../../shared/protocol/drafts.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { draftFeedback } from '../../hq/reviews.js';

export const draftsView: ViewPieces['drafts'] = (ctx, floor, c) =>
  ctx.hq?.studio?.state(floor?.id, c.accountId, ctx.drafts?.state(floor?.id, c.accountId, ctx.cubbies) ?? { enabled: false, canStart: false }) ?? ctx.drafts?.state(floor?.id, c.accountId, ctx.cubbies) ?? { enabled: false, canStart: false };
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
  'drafts.new'(ctx, c) { ctx.warn(c, 'Use New project through your Mac link'); },
  'drafts.kickoff'(ctx, c, msg) {
    ctx.sendTo(c, { t: 'drafts.kickoffFailed', floorId: msg.floorId, error: 'This draft predates the Mac Studio; start a New project' });
  },
  'drafts.feedback'(ctx, c, msg) {
    try {
      draftFeedback(ctx, c, msg);
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
} satisfies HandlerMap<DraftsClientMsg>;
