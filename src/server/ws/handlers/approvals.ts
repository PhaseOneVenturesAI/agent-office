import { createApprovalHandlers, type ApprovalAuthority } from '../../approvals/handlers.js';
import { canUseWorker } from '../../worker-ownership.js';
/** Safe personal-worker default. Coordinator replaces this callback with the maintained role ACL
 * and billing-custody policy at integration. A role never inherits a generic admin/owner bypass. */
export const approvalAuthority: ApprovalAuthority = (ctx, c, workerId) => {
  const floor = ctx.workerFloor(workerId), worker = floor?.workers.get(workerId);
  if (!floor || !worker || floor.isRoleWorker?.(workerId)) return false;
  return canUseWorker(ctx, c.accountId, floor.workers.ownerOf(workerId), worker.provider);
};
const feature = createApprovalHandlers(approvalAuthority);
export const approvalHandlers = feature.handlers;
export const approvalHooks = feature.hooks;
