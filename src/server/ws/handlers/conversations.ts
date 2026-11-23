import { canUseWorker } from '../../worker-ownership.js';
import type { ConversationClientMsg } from '../../../shared/protocol.js';
import type { Client } from '../../office/client.js';
import { conversationSupported } from '../../workers/conversations.js';
import { ownedWorker } from './worker-access.js';
import type { FeatureHooks, HandlerMap } from './types.js';

const listening = new WeakMap<Client, () => void>();
const close = (c: Client) => { listening.get(c)?.(); listening.delete(c); };
export const conversationHandlers = {
  'conversation.open'(ctx, c, msg) {
    close(c);
    const w = ownedWorker(ctx, c, msg.workerId);
    if (!w) return;
    const service = w.floor.workers.conversations;
    ctx.sendTo(c, { t: 'conversation.state', workerId: w.wid, supported: conversationSupported(w.info.provider), messages: service.snapshot(w.wid) });
    listening.set(c, service.subscribe(w.wid, (message) => {
      if (c.out || !ctx.stillIn(c) || ctx.floorOf(c) !== w.floor || !canUseWorker(ctx, c.accountId, w.floor.workers.ownerOf(w.wid), w.info.provider)) return close(c);
      ctx.sendTo(c, { t: 'conversation.message', workerId: w.wid, message });
    }));
  },
  'conversation.close'(_ctx, c) { close(c); },
  'conversation.send'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId);
    if (w) ctx.warn(c, w.floor.workers.conversations.send(w.wid, msg.text, c.peer.name));
  },
  'conversation.page'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId);
    if (!w) return;
    const messages = w.floor.workers.conversations.page(w.wid, typeof msg.before === 'number' ? msg.before : Date.now());
    ctx.sendTo(c, { t: 'conversation.history', workerId: w.wid, messages, end: messages.length < 30 });
  },
  'conversation.interrupt'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId);
    if (w) ctx.warn(c, w.floor.workers.conversations.stop(w.wid, c.peer.name));
  },
} satisfies HandlerMap<ConversationClientMsg>;
export const conversationHooks: FeatureHooks = { leaving: (_ctx, c) => close(c), closed: (_ctx, c) => close(c) };
