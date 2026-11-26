import type { PitchClientMsg } from '../../../shared/protocol/pitch.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';
export const pitchView: ViewPieces['pitch'] = (ctx, floor, c) => ctx.cubbies?.pitchView(floor?.id, c.out ? undefined : c.accountId);
const last = new WeakMap<Client, string>();
export function pitchChanged(ctx: Ctx) {
  if (!ctx.cubbies) return;
  for (const c of ctx.clients.values()) {
    const view = pitchView(ctx, ctx.floorOf(c), c), key = JSON.stringify(view) ?? '';
    if (last.get(c) === key) continue;
    last.set(c, key); ctx.sendTo(c, { t: 'pitch', ...(view ? { view } : {}) });
  }
}
export const pitchHandlers = {
  'pitch.verdict'(ctx, c, msg) {
    try {
      if (!c.accountId || c.out || ctx.floorOf(c)?.id !== msg.floorId) throw Error('Only the owner on this floor can review its pitch');
      ctx.cubbies.verdict(msg.floorId, c.accountId, msg.cubbyId, msg);
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
} satisfies HandlerMap<PitchClientMsg>;
