import type { DeliveryClientMsg } from '../../../shared/protocol/delivery.js';
import type { Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { validRepo, validSha, type DeliveryRef } from '../../delivery/runs.js';
import type { FeatureHooks, HandlerMap } from './types.js';

const viewing = new WeakMap<Client, { ref: DeliveryRef; floorId: string; off: () => void }>();
function close(ctx: Ctx, c: Client) {
  viewing.get(c)?.off();
  viewing.delete(c);
  ctx.deliveries.releaseOwner(c.id);
}
function current(ctx: Ctx, c: Client): DeliveryRef | undefined {
  const v = viewing.get(c), floor = ctx.floorOf(c);
  if (!v || floor?.id !== v.floorId || c.out) return;
  const pull = floor.github.pulls.items.find((p) => p.number === v.ref.number);
  if (pull?.headRefOid !== v.ref.sha) { close(ctx, c); ctx.warn(c, 'The PR head changed. Reopen CI evidence for its current commit.'); return; }
  return v.ref;
}
export const deliveryHandlers = {
  'delivery.open'(ctx, c, msg) {
    close(ctx, c);
    const floor = ctx.floorOf(c);
    const pull = floor?.github.pulls.items.find((p) => p.number === msg.number);
    const repo = floor?.def.repo;
    if (!floor || !pull || !repo || !validRepo(repo) || !pull.headRefOid || !validSha(pull.headRefOid)) return ctx.warn(c, 'Refresh the PR board: an exact source commit and repository are required');
    const ref = { repo, sha: pull.headRefOid, dir: floor.dir, number: pull.number };
    const send = () => { if (current(ctx, c)) ctx.sendTo(c, { t: 'delivery.state', state: ctx.deliveries.state(ref, c.id) }); };
    try {
      const off = ctx.deliveries.subscribe(ref, send);
      viewing.set(c, { ref, floorId: floor.id, off });
      send();
      void ctx.deliveries.refresh(ref);
    } catch { ctx.warn(c, 'Delivery readers are busy; close an unused evidence panel'); }
  },
  'delivery.refresh'(ctx, c) { const ref = current(ctx, c); if (ref) void ctx.deliveries.refresh(ref); },
  'delivery.watch'(ctx, c, msg) {
    const ref = current(ctx, c);
    if (ref) ctx.warn(c, ctx.deliveries.claim(ref, msg.runKey, { id: c.id, name: ctx.meOf(c.accountId).account?.name ?? `${c.peer.name} (browser session)` }));
  },
  'delivery.renew'(ctx, c, msg) { const ref = current(ctx, c); if (ref) ctx.deliveries.renew(ref, msg.runKey, c.id); },
  'delivery.release'(ctx, c, msg) { const ref = current(ctx, c); if (ref) ctx.deliveries.release(ref, msg.runKey, c.id); },
  'delivery.close': close,
} satisfies HandlerMap<DeliveryClientMsg>;
export const deliveryHooks: FeatureHooks = { leaving: close, closed: close };
