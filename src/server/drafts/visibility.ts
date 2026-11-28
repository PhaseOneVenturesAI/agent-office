import type { PeerInfo, ServerMsg } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';

/** People remain in the office list, but their private floor/location never leaves its owner. */
export function visibleMessage(ctx: Ctx, c: Client, msg: ServerMsg): ServerMsg {
  const peer = (p: PeerInfo): PeerInfo => {
    if (!p.floor || ctx.floorVisible(p.floor, c)) return p;
    return { id: p.id, name: p.name, color: p.color, look: p.look, account: p.account, status: p.status,
      x: 0, y: 0, z: 0, rotY: 0, moving: false, voice: false, muted: true, sharing: false };
  };
  if (msg.t === 'peer.join' || msg.t === 'peer.update') return { ...msg, peer: peer(msg.peer) };
  if (msg.t === 'welcome' || msg.t === 'floor.enter') return { ...msg, peers: msg.peers.map(peer) };
  return msg;
}

/** Draft work runs on the owner's computer. These server execution entrances stay closed. */
export function draftExecution(ctx: Ctx, c: Client, type: string): boolean {
  if (!['worker.spawn', 'station.prompt', 'meeting.start', 'queue.add', 'queue.retry', 'queue.limit'].includes(type) || !ctx.floorOf(c)?.def.draft) return false;
  ctx.warn(c, 'Draft work runs on your computer. Set up your cubby at the studio table to work with your lead');
  return true;
}
