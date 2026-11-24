import { canUseRoleWorker } from '../../role-subscriptions/access.js';
import { canAccessRoleWorker } from '../../role-access.js';
import { OWN_WORKER } from '../../worker-ownership.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { workerOf } from './common.js';

/** Conversation and handoff are private to the credential owner on the current floor. */
export function ownedWorker(ctx: Ctx, c: Client, id: unknown, quietMissing = false) {
  const worker = workerOf(ctx, id);
  if (!worker) { if (!quietMissing) ctx.warn(c, 'No such worker'); return; }
  if (worker.floor !== ctx.floorOf(c) || !canAccessRoleWorker(ctx, worker.floor, worker.wid, c.accountId) || !canUseRoleWorker(ctx, c.accountId, worker.floor, worker.wid)) {
    ctx.warn(c, OWN_WORKER);
    return;
  }
  return worker;
}
