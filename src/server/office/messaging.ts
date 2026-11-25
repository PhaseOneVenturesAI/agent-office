import { visibleMessage } from '../drafts/visibility.js';
import { canSeeWorker, canViewTerminal, publicWorker } from '../worker-ownership.js';
import { WebSocket } from 'ws';
import type { Ctx, Messaging, ToastLevel } from './context.js';
import type { Client } from './client.js';
import type { Floor } from '../floor.js';
import type { ServerMsg, WorkerInfo } from '../../shared/protocol.js';

/** Sending to the browsers in `ctx.clients`: one, everyone, a floor, or someone's neighbors. */
export function messaging(ctx: Ctx): Messaging {
  const sendTo = (c: Client, msg: ServerMsg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(visibleMessage(ctx, c, msg)));
  };
  const broadcast = (msg: ServerMsg, except?: string, droppable = false) => {
    for (const c of ctx.clients.values()) {
      if (c.id === except || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      sendTo(c, msg);
    }
  };
  const toastAll = (text: string, level: ToastLevel = 'info') => broadcast({ t: 'toast', text, level });
  /** To everyone on one floor. */
  const toFloor = (floor: Floor, msg: ServerMsg, droppable = false) => {
    let owner: string | undefined;
    if (msg.t === 'worker.update') {
      // Restored usage can emit inside WorkerManager's constructor, before Floor assigns it.
      // The initialized floor snapshot will carry the verified owner when clients arrive.
      if (!floor.workers) return;
      owner = floor.workers.ownerOf(msg.worker.id);
      msg = { ...msg, worker: publicWorker(ctx, msg.worker, owner) };
    }
    const json = JSON.stringify(msg);
    for (const c of ctx.clients.values()) {
      if (c.peer.floor !== floor.id || !ctx.floorVisible(floor.id, c) || c.ws.readyState !== WebSocket.OPEN) continue;
      // A private worker's updates only reach its owner, the admins and the coworkers it's shared with.
      if (msg.t === 'worker.update' && !canSeeWorker(ctx, c.accountId, msg.worker, owner)) continue;
      if (msg.t === 'screen' && !canViewTerminal(ctx, c.accountId, msg.workerId)) continue;
      if (droppable && c.ws.bufferedAmount > 4 * 1024 * 1024) continue;
      c.ws.send(json);
    }
  };
  const toastFloor = (floor: Floor | undefined, text: string, level: ToastLevel = 'info') => {
    if (floor) toFloor(floor, { t: 'toast', text, level });
  };
  /** About one worker, to the people on its floor who may see it: a private worker doesn't summon the whole floor. */
  const toastWorker = (floor: Floor | undefined, worker: WorkerInfo, owner: string | undefined, text: string, level: ToastLevel = 'info') => {
    if (!floor) return;
    const json = JSON.stringify({ t: 'toast', text, level });
    for (const c of ctx.clients.values()) {
      if (c.peer.floor !== floor.id || !ctx.floorVisible(floor.id, c) || c.ws.readyState !== WebSocket.OPEN) continue;
      if (!canSeeWorker(ctx, c.accountId, worker, owner)) continue;
      c.ws.send(json);
    }
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
  return { sendTo, broadcast, toastAll, toFloor, toastFloor, toastWorker, toNeighbors, warn };
}
