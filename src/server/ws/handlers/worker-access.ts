import { canManageWorker, canUseWorker, OWN_WORKER } from '../../worker-ownership.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { workerOf } from './common.js';

function access(ctx: Ctx, c: Client, id: unknown, quietMissing: boolean, allowed: (owner: string | undefined, sharedWith: string[] | undefined, provider: Parameters<typeof canUseWorker>[3]) => boolean) {
  const worker = workerOf(ctx, id);
  if (!worker) { if (!quietMissing) ctx.warn(c, 'No such worker'); return; }
  const owner = worker.floor.workers.ownerOf(worker.wid);
  if (worker.floor !== ctx.floorOf(c) || !allowed(owner, worker.info.sharedWith, worker.info.provider)) {
    ctx.warn(c, OWN_WORKER);
    return;
  }
  return worker;
}

/** Managing a worker — sending it home, resuming it, changing who it's shared with — is its owner's and the admins', on the current floor. */
export function ownedWorker(ctx: Ctx, c: Client, id: unknown, quietMissing = false) {
  return access(ctx, c, id, quietMissing, (owner) => canManageWorker(ctx, c.accountId, owner));
}

/** Conversation, handoff and the terminal are the owner’s, the admins’ and the coworkers the worker is shared with, on the current floor. */
export function usableWorker(ctx: Ctx, c: Client, id: unknown, quietMissing = false) {
  return access(ctx, c, id, quietMissing, (owner, sharedWith, provider) => canUseWorker(ctx, c.accountId, owner, provider, sharedWith));
}
