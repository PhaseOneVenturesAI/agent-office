// The Review Room (see server/reviews.ts): anyone stages a link, anyone accepts or rejects it
// with a reason; a worker that staged it hears the verdict in its terminal.
import type { ReviewsClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

export const reviewsHandlers = {
  'reviews.get'(ctx, c) {
    ctx.sendTo(c, { t: 'reviews', state: ctx.reviews.state() });
  },
  'reviews.submit'(ctx, c, msg) {
    const r = ctx.reviews.submit({ title: str(msg.title, 200), url: str(msg.url, 600), note: str(msg.note, 600), gate: msg.gate, kind: msg.kind, group: msg.group, version: msg.version, references: msg.references, by: c.peer.name, floorId: ctx.floorOf(c)?.id });
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toastAll(`🎬 ${c.peer.name} staged “${r.title}” for review`);
  },
  'reviews.resolve'(ctx, c, msg) {
    const r = ctx.reviews.resolve(str(msg.id, 40), msg.ok === true, str(msg.reason, 600), c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    const { item, prompt } = r;
    const mark = item.status === 'accepted' ? '✅' : '❌';
    ctx.toastAll(`${mark} ${c.peer.name} ${item.status} “${item.title}”`);
    // A worker that staged it hears the verdict and the reason in its terminal, so it can take
    // the next take right away. A stopped one wakes up to it.
    if (prompt && item.workerId) {
      const floor = ctx.workerFloor(item.workerId);
      const w = floor?.workers.get(item.workerId);
      if (floor && w && w.kind === 'agent') {
        let err = floor.workers.prompt(item.workerId, prompt, c.peer.name);
        if (err === 'Worker is not running') err = floor.workers.resume(item.workerId, prompt);
        if (err) ctx.toastAll(`Couldn't tell ${w.name} the verdict: ${err}`, 'warn');
      }
    }
  },
  'reviews.stage'(ctx, c, msg) {
    const r = ctx.reviews.stage(str(msg.id, 40), msg.stage, str(msg.note, 600), c.peer.name);
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.toastAll(`🎬 ${c.peer.name} moved “${r.title}” to ${msg.stage}`);
  },
} satisfies HandlerMap<ReviewsClientMsg>;
