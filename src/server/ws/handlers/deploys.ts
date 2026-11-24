// Read-only Cloudflare project listing (see server/deploys.ts).
import type { DeploysClientMsg } from '../../../shared/protocol.js';
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
} satisfies HandlerMap<DeploysClientMsg>;
