import { canUseRoleWorker } from '../../role-subscriptions/access.js';
import { createApprovalHandlers, type ApprovalAuthority } from '../../approvals/handlers.js';
import { roleAccess, roleOrigin } from '../../role-access.js';
/** Role authority and runtime credential ownership are separate checks. Editable custodian
 * metadata alone is not consent. Shared manager use requires the scoped custodian grant. */
export const approvalAuthority: ApprovalAuthority = (ctx, c, workerId) => {
  const floor = ctx.workerFloor(workerId), worker = floor?.workers.get(workerId);
  if (!floor || !worker) return false;
  if (roleOrigin(floor, workerId)) {
    const access = roleAccess(ctx, floor, workerId, c.accountId);
    if (access.kind !== 'owner' && access.kind !== 'controller') return false;
  }
  return canUseRoleWorker(ctx, c.accountId, floor, workerId);
};
const feature = createApprovalHandlers(approvalAuthority);
export const approvalHandlers = feature.handlers;
export const approvalHooks = feature.hooks;
