// The providers' plan limits under the workers.
import type { UsageClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const usageHandlers = {
  'limits.refresh'(ctx, c, m) {
    ctx.limitsOf(c).refresh(m.provider);
  },
} satisfies HandlerMap<UsageClientMsg>;
