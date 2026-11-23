import { canUseRoleWorker } from '../../role-subscriptions/access.js';
import { OWN_WORKER } from '../../worker-ownership.js';
import type { ConversationClientMsg } from '../../../shared/protocol.js';
import type { Client } from '../../office/client.js';
import { conversationSupported } from '../../workers/conversations.js';
import { roleAccess, roleOrigin } from '../../role-access.js';
import { workerOf } from './common.js';
import { ownedWorker } from './worker-access.js';
import type { FeatureHooks, HandlerMap } from './types.js';

const listening = new WeakMap<Client, () => void>();
const close = (c: Client) => { listening.get(c)?.(); listening.delete(c); };

/**
 * One authorized person's window on a worker's conversation. Ordinary workers stay credential-
 * owned (see worker-access). Role characters (the CEO, department managers) use role access: the
 * owner/controllers get the authoritative conversation; anyone else in the Q&A audience gets
 * read-only questions under the staff scope — never able to assign, delegate, or change decisions.
 */
export const conversationHandlers = {
  'conversation.open'(ctx, c, msg) {
    close(c);
    const role = workerOf(ctx, msg.workerId);
    let wid: string | undefined, floor = role?.floor;
    if (role && roleOrigin(role.floor, role.wid)) {
      // Role characters: only the owner/controllers talk to them — staff Q&A never enters the
      // manager's own session (see staff-qa.ts); it runs on a separate read-only session.
      const access = roleAccess(ctx, role.floor, role.wid, c.accountId);
      if (access.kind === 'staff') return ctx.warn(c, 'Read-only questions go in the Ask box on the manager’s card — they never enter this conversation.');
      if (access.kind === 'none') return ctx.warn(c, access.why || 'Not available.');
      if (role.floor !== ctx.floorOf(c)) return ctx.warn(c, 'Choose your own existing worker on this floor.');
      if (!canUseRoleWorker(ctx, c.accountId, role.floor, role.wid)) return ctx.warn(c, OWN_WORKER);
      wid = role.wid;
    } else {
      const w = ownedWorker(ctx, c, msg.workerId);
      if (!w) return;
      wid = w.wid;
      floor = w.floor;
    }
    if (!wid || !floor) return;
    const service = floor.workers.conversations;
    ctx.sendTo(c, { t: 'conversation.state', workerId: wid, supported: conversationSupported(floor.workers.get(wid)?.provider), messages: service.snapshot(wid) });
    listening.set(c, service.subscribe(wid, (message) => {
      if (c.out || !ctx.stillIn(c) || ctx.floorOf(c) !== floor) return close(c);
      // Role authority is re-checked on every message: revoked ownership or delegation closes the stream.
      if (roleOrigin(floor, wid)) {
        const access = roleAccess(ctx, floor, wid, c.accountId);
        if (access.kind !== 'owner' && access.kind !== 'controller') return close(c);
      }
      if (!canUseRoleWorker(ctx, c.accountId, floor, wid)) return close(c);
      if (message.scope !== 'staff') ctx.sendTo(c, { t: 'conversation.message', workerId: wid, message });
    }));
  },
  'conversation.close'(_ctx, c) { close(c); },
  'conversation.send'(ctx, c, msg) {
    const role = workerOf(ctx, msg.workerId);
    if (role && roleOrigin(role.floor, role.wid)) {
      const access = roleAccess(ctx, role.floor, role.wid, c.accountId);
      if (access.kind === 'staff') return ctx.warn(c, 'Read-only questions go in the Ask box on the manager’s card — they never enter this conversation.');
      if (access.kind === 'none') return ctx.warn(c, access.why || 'Not available.');
      if (role.floor !== ctx.floorOf(c)) return ctx.warn(c, 'Choose your own existing worker on this floor.');
      if (!canUseRoleWorker(ctx, c.accountId, role.floor, role.wid)) return ctx.warn(c, OWN_WORKER);
      return ctx.warn(c, role.floor.workers.conversations.send(role.wid, msg.text, c.peer.name));
    }
    const w = ownedWorker(ctx, c, msg.workerId);
    if (w) ctx.warn(c, w.floor.workers.conversations.send(w.wid, msg.text, c.peer.name));
  },
  'conversation.page'(ctx, c, msg) {
    const role = workerOf(ctx, msg.workerId);
    if (role && roleOrigin(role.floor, role.wid)) {
      const access = roleAccess(ctx, role.floor, role.wid, c.accountId);
      if (access.kind !== 'owner' && access.kind !== 'controller') return;
      if (role.floor !== ctx.floorOf(c) || !canUseRoleWorker(ctx, c.accountId, role.floor, role.wid)) return;
    } else {
      const w = ownedWorker(ctx, c, msg.workerId);
      if (!w) return;
    }
    const floor = ctx.workerFloor(String(msg.workerId));
    const messages = floor?.workers.conversations.page(String(msg.workerId), typeof msg.before === 'number' ? msg.before : Date.now()) ?? [];
    ctx.sendTo(c, { t: 'conversation.history', workerId: String(msg.workerId), messages, end: messages.length < 30 });
  },
  'conversation.interrupt'(ctx, c, msg) {
    const w = ownedWorker(ctx, c, msg.workerId);
    if (w && roleOrigin(w.floor, w.wid)) {
      const access = roleAccess(ctx, w.floor, w.wid, c.accountId);
      if (access.kind !== 'owner' && access.kind !== 'controller') return ctx.warn(c, 'Role access changed; no interruption was sent.');
    }
    if (w) ctx.warn(c, w.floor.workers.conversations.stop(w.wid, c.peer.name));
  },
} satisfies HandlerMap<ConversationClientMsg>;
export const conversationHooks: FeatureHooks = { leaving: (_ctx, c) => close(c), closed: (_ctx, c) => close(c) };
