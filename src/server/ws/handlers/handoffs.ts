// Engine swaps (see docs/department-leads.md): an explicit handoff of a worker's task to a
// replacement worker on another engine. The replacement is seated idle, the handoff is prepared for
// review, and the existing acknowledge delivers it exactly once — never an in-place conversion.
import { isAgentEffort, isAgentProvider, type HandoffClientMsg } from '../../../shared/protocol.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { swapBrief } from '../../workers/handoffs.js';
import { nextFreeSeat } from '../../../shared/layout.js';
import { str } from '../../office/input.js';
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
  'handoff.swap'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId);
    if (!source) return;
    const floor = source.floor;
    const info = source.info;
    if (info.kind !== 'agent') return ctx.warn(c, 'Only an agent worker can change engines');
    if (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider)) return ctx.warn(c, `Unknown agent provider`);
    if (info.handoff?.state === 'pending') return ctx.warn(c, 'Review the pending handoff first; it has not been delivered.');
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    const note = str(msg.note, 4000) || undefined;
    const engine = `${msg.provider}${model ? ` · ${model}` : ''}`;
    const seat = () => {
      // The replacement starts from the fresh base in its own worktree, idle: it gets its real task
      // through the acknowledged handoff, not a second prompt.
      const desk = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
      if (!desk) return ctx.warn(c, 'No free desk for the replacement — send someone home first');
      const r = floor.workers.spawn(desk, c.peer.name, undefined, !!info.worktree || !!floor.project.branch, 'agent', msg.provider, model, effort, undefined, c.accountId);
      if (typeof r === 'string') return ctx.warn(c, r);
      const result = floor.workers.handoffs.prepare(source.wid, r.id, swapBrief(info, engine, note), c.peer.name);
      if (typeof result === 'string') {
        // The handoff wouldn't hold: the replacement has nothing to do — send it straight home.
        void floor.sendHome(r.id);
        return ctx.warn(c, result);
      }
      ctx.toastFloor(floor, `🔁 ${c.peer.name} staged an engine swap: ${info.name} → ${engine}`);
      ctx.sendTo(c, { t: 'handoff.preview', workerId: source.wid, handoff: result });
    };
    ctx.withSignIn(c, ctx.signInFor(msg.provider), () => ctx.withFreshBase(c, [floor], seat));
  },
} satisfies HandlerMap<HandoffClientMsg>;
