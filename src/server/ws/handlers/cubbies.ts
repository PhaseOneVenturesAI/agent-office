import { draftsChanged } from './drafts.js';
import type { CubbiesClientMsg } from '../../../shared/protocol/cubbies.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';
export const cubbiesView: ViewPieces['cubbies'] = (ctx, floor, c) => ctx.cubbies?.state(floor?.id, c.accountId) ?? { enabled: false, cubbies: [], setupAllowed: false };
const last = new WeakMap<Client, string>();
export function cubbiesChanged(ctx: Ctx) {
  draftsChanged(ctx);
  if (!ctx.cubbies) return; // Services are constructed before the context is assigned.
  for (const c of ctx.clients.values()) {
    const state = cubbiesView(ctx, ctx.floorOf(c), c), key = JSON.stringify(state);
    if (last.get(c) === key) continue;
    last.set(c, key); ctx.sendTo(c, { t: 'cubbies', state });
  }
}
export const cubbiesHandlers = {
  'cubbies.get'(ctx, c) { ctx.sendTo(c, { t: 'cubbies', state: cubbiesView(ctx, ctx.floorOf(c), c) }); },
  'cubbies.setup'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (!c.accountId || !floor) return ctx.warn(c, 'Sign in to set up your cubby on a project floor');
    try { ctx.sendTo(c, { t: 'cubbies.token', ...ctx.cubbies.setup(floor.id, c.accountId, msg.slot, msg.leadName, msg.look) }); }
    catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'cubbies.chat'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (!c.accountId || !floor) return ctx.warn(c, 'Only the cubby owner can talk to its lead');
    try { ctx.cubbies.chat(floor.id, c.accountId, msg.id, msg); }
    catch (e) { ctx.warn(c, (e as Error).message); }
  },
} satisfies HandlerMap<CubbiesClientMsg>;
