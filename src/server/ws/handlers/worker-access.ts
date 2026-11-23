import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { workerOf } from './common.js';

/** Conversation and handoff are private to the credential owner on the current floor. */
export function ownedWorker(ctx: Ctx, c: Client, id: unknown) {
  const worker = workerOf(ctx, id);
  const owner = worker?.floor.workers.ownerOf(worker.wid);
  if (!worker || worker.floor !== ctx.floorOf(c) || (owner ? owner !== c.accountId : !ctx.meOf(c.accountId).admin)) {
    ctx.warn(c, 'Choose your own existing worker on this floor. Office-owned workers require an admin.');
    return;
  }
  return worker;
}
