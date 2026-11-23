import { createApprovalHandlers, type ApprovalAuthority } from '../../approvals/handlers.js';
import { roleAccess } from '../../role-access.js';
import { canUseWorker } from '../../worker-ownership.js';
/** Role authority and runtime credential ownership are separate checks. Editable custodian
 * metadata is not a subscription-sharing grant. No generic admin or controller bypass. */
export const approvalAuthority: ApprovalAuthority = (ctx, c, workerId) => {
  const floor = ctx.workerFloor(workerId), worker = floor?.workers.get(workerId);
  if (!floor || !worker) return false;
  if (floor.isRoleWorker?.(workerId)) {
    const access = roleAccess(ctx, floor, workerId, c.accountId);
    if (access.kind !== 'owner' && access.kind !== 'controller') return false;
  }
  return canUseWorker(ctx, c.accountId, floor.workers.ownerOf(workerId), worker.provider);
};
const feature = createApprovalHandlers(approvalAuthority);
export const approvalHandlers = feature.handlers;
export const approvalHooks = feature.hooks;
