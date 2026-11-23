// The cost wall (see server/costwall.ts): the numbers for everyone, recomputed when asked.
import type { CostwallClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const costwallHandlers = {
  'costwall.get'(ctx, c) {
    ctx.sendTo(c, { t: 'costwall', state: ctx.costwall.state() });
  },
} satisfies HandlerMap<CostwallClientMsg>;
