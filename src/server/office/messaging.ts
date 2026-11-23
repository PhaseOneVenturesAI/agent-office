import { canViewTerminal, publicWorker } from '../worker-ownership.js';
import { publicRoleWorker, roleAccess } from '../role-access.js';
import { WebSocket } from 'ws';
import type { Ctx, Messaging, ToastLevel } from './context.js';
import type { Client } from './client.js';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';

/** Sending to the browsers in `ctx.clients`: one, everyone, a floor, or someone's neighbors. */
export function messaging(ctx: Ctx): Messaging {
  const sendTo = (c: Client, msg: ServerMsg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMsg, except?: string, droppable = false) => {
    const json = JSON.stringify(msg);
    for (const c of ctx.clients.values()) {
      if (c.id === except || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      c.ws.send(json);
    }
  };
  const toastAll = (text: string, level: ToastLevel = 'info') => broadcast({ t: 'toast', text, level });
  /** To everyone on one floor. */
  const toFloor = (floor: Floor, msg: ServerMsg, droppable = false) => {
    // Role characters' private content (prompt, activity, task, handoff, usage, worktree) goes only
    // to their owner/controllers; everyone else gets the public shell — name, engine, desk, status.
    const roleMsg = msg.t === 'worker.update' && floor.isRoleWorker(msg.worker.id) ? msg : undefined;
    if (msg.t === 'worker.update' && !roleMsg) msg = { ...msg, worker: publicWorker(ctx, msg.worker) };
    for (const c of ctx.clients.values()) {
      if (c.peer.floor !== floor.id || c.ws.readyState !== WebSocket.OPEN) continue;
      if (msg.t === 'screen' && !canViewTerminal(ctx, c.accountId, msg.workerId)) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      if (roleMsg) {
        const access = roleAccess(ctx, floor, roleMsg.worker.id, c.accountId);
        c.ws.send(JSON.stringify({ ...roleMsg, worker: publicRoleWorker(roleMsg.worker, access.kind) }));
      } else {
        c.ws.send(JSON.stringify(msg));
      }
    }
  };
  const toastFloor = (floor: Floor | undefined, text: string, level: ToastLevel = 'info') => {
    if (floor) toFloor(floor, { t: 'toast', text, level });
  };
  /** To everyone else on the same floor as `c`: nobody on another floor can see them. */
  const toNeighbors = (c: Client, msg: ServerMsg, droppable = false) => {
    if (!c.peer.floor) return;
    const json = JSON.stringify(msg);
    for (const o of ctx.clients.values()) {
      if (o.id === c.id || o.peer.floor !== c.peer.floor || o.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && o.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      o.ws.send(json);
    }
  };
  /** Tells just this person why their request didn't happen; nothing when there's no error. */
  const warn = (c: Client, error: string | undefined) => {
    if (error) sendTo(c, { t: 'toast', text: error, level: 'warn' });
  };
  return { sendTo, broadcast, toastAll, toFloor, toastFloor, toNeighbors, warn };
}
