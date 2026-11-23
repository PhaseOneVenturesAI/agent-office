import type { ApprovalClientMsg } from '../../shared/protocol/approvals.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { FeatureHooks, HandlerMap } from '../ws/handlers/types.js';
/** Must check current role authority AND authorized billing custody, or ordinary worker ownership. */
export type ApprovalAuthority = (ctx: Ctx, c: Client, workerId: string) => boolean;
/** No permissive default: the coordinator supplies the maintained role/credential policy. */
export function createApprovalHandlers(authorize: ApprovalAuthority) {
  const subscriptions = new WeakMap<Client, () => void>();
  const close = (c: Client) => { subscriptions.get(c)?.(); subscriptions.delete(c); };
  const allowed = (ctx: Ctx, c: Client, id: string) => !c.out && ctx.stillIn(c) && ctx.workerFloor(id) === ctx.floorOf(c) && authorize(ctx, c, id);
  const handlers = {
    'approval.open'(ctx, c, msg) {
      close(c);
      if (!allowed(ctx, c, msg.workerId)) return ctx.warn(c, 'You cannot control approvals for this agent');
      const floor = ctx.workerFloor(msg.workerId)!;
      let last = '';
      const publish = (state: ReturnType<typeof floor.workers.approvals.state>) => {
        if (!allowed(ctx, c, msg.workerId)) {
          close(c); ctx.sendTo(c, { t: 'approval.state', workerId: msg.workerId, state: { queued: 0, fallback: 'Approval access changed. Reopen an authorized conversation.' } }); return;
        }
        const key = JSON.stringify(state);
        if (key === last) return; last = key;
        ctx.sendTo(c, { t: 'approval.state', workerId: msg.workerId, state });
      };
      publish(floor.workers.approvals.state(msg.workerId));
      subscriptions.set(c, floor.workers.approvals.subscribe(msg.workerId, publish));
    },
    'approval.close'(_ctx, c) { close(c); },
    'approval.answer'(ctx, c, msg) {
      const error = !allowed(ctx, c, msg.workerId) ? 'Your approval access changed; no decision was submitted'
        : ctx.workerFloor(msg.workerId)!.workers.approvals.answer(msg.workerId, msg.requestId, msg.optionId);
      ctx.sendTo(c, { t: 'approval.result', workerId: msg.workerId, requestId: msg.requestId, ...(error ? { error } : {}) });
    },
    'approval.terminal'(ctx, c, msg) {
      const error = !allowed(ctx, c, msg.workerId) ? 'Your approval access changed; no decision was submitted'
        : ctx.workerFloor(msg.workerId)!.workers.approvals.terminal(msg.workerId, msg.requestId);
      ctx.sendTo(c, { t: 'approval.result', workerId: msg.workerId, requestId: msg.requestId, ...(error ? { error } : {}) });
    },
  } satisfies HandlerMap<ApprovalClientMsg>;
  const hooks: FeatureHooks = { leaving: (_ctx, c) => close(c), closed: (_ctx, c) => close(c) };
  return { handlers, hooks };
}
