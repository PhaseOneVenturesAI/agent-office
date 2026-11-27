import { passManagerMessage } from './messages.js';
import { hqChat } from './leads.js';
import type { ClientMsg } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
/** HQ is a viewing/talking floor. Work and signed approvals remain on the owner's Mac. */
export function hqDispatch(ctx: Ctx, c: Client, msg: ClientMsg): boolean {
  if (msg.t === 'cubbies.chat' && 'hqMessageId' in msg) {
    try { passManagerMessage(ctx, c, msg); } catch (e) { ctx.warn(c, (e as Error).message); }
    return true;
  }
  if (!ctx.hq) return false;
  if (msg.t === 'floor.remove' && ctx.hq.is(msg.floor)) {
    if (!ctx.hq.visible(msg.floor, c.accountId)) { ctx.warn(c, 'No such floor'); return true; }
    if (!ctx.hq.owns(c.accountId)) ctx.warn(c, 'Only the HQ owner can remove this floor');
    else {
      const floor = ctx.floors.get(msg.floor);
      if (floor) void ctx.closeFloor(floor, ctx.hq.ownerName).then(e => ctx.warn(c, e), () => ctx.warn(c, 'HQ could not close'));
    }
    return true;
  }
  if (msg.t === 'drafts.kickoff' && ctx.hq.is(msg.floorId)) { ctx.warn(c, ctx.hq.visible(msg.floorId, c.accountId) ? 'HQ cannot be kicked off' : 'No such floor'); return true; }
  const floor = ctx.floorOf(c);
  if (!ctx.hq.is(floor?.id)) return false;
  if (msg.t === 'cubbies.chat') {
    try { hqChat(ctx, c, msg); } catch (e) { ctx.warn(c, (e as Error).message); }
    return true;
  }
  if (msg.t.startsWith('queue.') || ['worker.spawn', 'station.prompt', 'meeting.start', 'cubbies.sendTask'].includes(msg.t)) {
    ctx.warn(c, 'HQ work runs on the owner’s computer'); return true;
  }
  if (msg.t === 'chat') {
    const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 500) : '';
    if (text) ctx.toFloor(floor!, { t: 'chat', from: c.id, name: ctx.accounts.get(c.accountId!)!.name, color: c.peer.color, text, at: Date.now(), account: true });
    return true; // Never add private HQ chat to the building-wide history.
  }
  return false;
}
