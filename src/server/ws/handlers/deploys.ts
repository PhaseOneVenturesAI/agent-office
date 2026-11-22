// The Deploy board (see server/deploys.ts): the office's Cloudflare projects, and staging one
// for a verdict in the Review Room.
import type { DeploysClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

export const deploysHandlers = {
  'deploys.get'(ctx, c) {
    ctx.sendTo(c, { t: 'deploys', state: ctx.deploys.state() });
    void ctx.deploys.refresh();
  },
  'deploys.refresh'(ctx, c) {
    if (!ctx.deploys.state().configured) return ctx.warn(c, 'The Deploy board has no Cloudflare credentials yet — set them on the server');
    void ctx.deploys.refresh(true);
  },
  'deploys.stage'(ctx, c, msg) {
    const item = ctx.deploys.get(str(msg.id, 120));
    if (!item) return ctx.warn(c, 'That deployment is gone — refresh the board');
    if (!item.url) return ctx.warn(c, `${item.name} has no URL to look at`);
    const r = ctx.reviews.submit({ title: item.name, url: item.url, note: `${item.kind === 'pages' ? 'Cloudflare Pages' : 'Cloudflare Worker'} deployment`, by: c.peer.name });
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toastAll(`🚀 ${c.peer.name} staged ${item.name} for review`);
  },
} satisfies HandlerMap<DeploysClientMsg>;
