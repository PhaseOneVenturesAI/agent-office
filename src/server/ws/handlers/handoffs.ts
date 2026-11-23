// Engine swaps (see docs/department-leads.md): an explicit handoff of a worker's task to a
// replacement worker on another engine. The source is reserved before anything spawns, the
// replacement is seated idle, the handoff is prepared for review, and the existing acknowledge
// delivers it exactly once — never an in-place conversion.
import { isAgentEffort, isAgentProvider, type HandoffClientMsg } from '../../../shared/protocol.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { swapBrief, swapGuard } from '../../workers/handoffs.js';
import { nextFreeSeat } from '../../../shared/layout.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { ownedWorker } from './worker-access.js';

export const handoffHandlers = {
  'handoff.cancel'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId);
    if (!source) return;
    const err = source.floor.workers.handoffs.cancel(source.wid, msg.handoffId);
    ctx.warn(c, err);
    // A cancelled swap takes its still-idle replacement with it: no orphan agents.
    if (!err && source.info.swap) {
      const replacement = source.info.swap.replacementId;
      source.floor.workers.handoffs.clearSwap(source.wid);
      if (replacement) void source.floor.sendHome(replacement);
    }
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
    const err = source.floor.workers.handoffs.acknowledge(source.wid, msg.handoffId, c.peer.name);
    ctx.warn(c, err);
    if (!err && source.info.swap) {
      // The swap landed: the manager and CEO identities and the roster follow the replacement;
      // the source's reservation clears. The source keeps its own session, transcript and branch.
      const engine = source.info.swap.engine;
      source.floor.departments.relinkWorker(source.wid, handoff.to);
      source.floor.ceo.relinkWorker(source.wid, handoff.to);
      source.floor.workers.handoffs.clearSwap(source.wid);
      ctx.toastFloor(source.floor, `🔁 ${handoff.toName} took over ${source.info.name}'s work on ${engine} — ${source.info.name} keeps its own session and branch; send it home when you're done with it`);
    } else if (err && source.info.swap && source.info.handoff?.state === 'delivery-failed') {
      // The one-shot delivery failed: free the source and say what the idle replacement is for.
      source.floor.workers.handoffs.clearSwap(source.wid);
      ctx.toastFloor(source.floor, `🔁 The swap handoff failed to deliver — its replacement sits idle at a desk; send it home or stage a fresh swap.`, 'warn');
    }
  },
  'handoff.swap'(ctx, c, msg) {
    const source = ownedWorker(ctx, c, msg.workerId);
    if (!source) return;
    const floor = source.floor;
    const info = source.info;
    if (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider)) return ctx.warn(c, `Unknown agent provider`);
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    const note = str(msg.note, 4000) || undefined;
    const engine = `${msg.provider}${model ? ` · ${model}` : ''}`;
    // Every refusal that must fire before a replacement spawns, in one guard.
    const guard = swapGuard(info);
    if (guard) return ctx.warn(c, guard);
    const reserve = () => {
      // The reservation marks the source first: a second swap, a prompt or a handoff sees it.
      const reserved = floor.workers.handoffs.reserve(source.wid, { engine, by: c.peer.name, at: Date.now() });
      if (reserved) return ctx.warn(c, reserved);
      // The replacement starts from the fresh base in its own worktree, idle: it gets its real task
      // through the acknowledged handoff, not a second prompt.
      const desk = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
      if (!desk) {
        floor.workers.handoffs.clearSwap(source.wid);
        return ctx.warn(c, 'No free desk for the replacement — send someone home first');
      }
      const r = floor.workers.spawn(desk, c.peer.name, undefined, !!info.worktree || !!floor.project.branch, 'agent', msg.provider, model, effort, undefined, c.accountId);
      if (typeof r === 'string') {
        floor.workers.handoffs.clearSwap(source.wid);
        return ctx.warn(c, r);
      }
      const result = floor.workers.handoffs.prepare(source.wid, r.id, swapBrief(info, engine, note), c.peer.name);
      if (typeof result === 'string') {
        // The handoff wouldn't hold: roll everything back, replacement included.
        floor.workers.handoffs.clearSwap(source.wid);
        void floor.sendHome(r.id);
        return ctx.warn(c, result);
      }
      // Verified — reservation held, replacement seated, handoff persisted. Only then say so.
      floor.workers.handoffs.tagReplacement(source.wid, r.id);
      ctx.toastFloor(floor, `🔁 ${c.peer.name} staged an engine swap: ${info.name} → ${engine}`);
      ctx.sendTo(c, { t: 'handoff.preview', workerId: source.wid, handoff: result });
    };
    ctx.withSignIn(c, ctx.signInFor(msg.provider), () => ctx.withFreshBase(c, [floor], reserve));
  },
} satisfies HandlerMap<HandoffClientMsg>;
