import type { HandoffClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';
import { ownedWorker } from './worker-access.js';

export const handoffHandlers = {
  'handoff.cancel'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId);
    if (source) ctx.warn(c, source.floor.workers.handoffs.cancel(source.wid, msg.handoffId));
  },
  'handoff.prepare'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId), target = ownedWorker(ctx, c, msg.targetId);
    if (!source || !target) return;
    const result = source.floor.workers.handoffs.prepare(source.wid, target.wid, msg.brief, c.peer.name);
    if (typeof result === 'string') ctx.warn(c, result);
    else ctx.sendTo(c, { t: 'handoff.preview', workerId: source.wid, handoff: result });
  },
  'handoff.ack'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId);
    if (!source) return;
    const handoff = source.info.handoff;
    if (!handoff || !ownedWorker(ctx, c, handoff.to)) return;
    ctx.warn(c, source.floor.workers.handoffs.acknowledge(source.wid, msg.handoffId, c.peer.name));
  },
} satisfies HandlerMap<HandoffClientMsg>;
