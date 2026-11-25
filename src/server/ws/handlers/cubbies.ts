import { addQueueTask } from './queue.js';
import { draftsChanged } from './drafts.js';
import type { CubbiesClientMsg } from '../../../shared/protocol/cubbies.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';
export const cubbiesView: ViewPieces['cubbies'] = (ctx, floor, c) => ctx.cubbies?.state(floor?.id, c.out ? undefined : c.accountId, c.id) ?? { enabled: false, cubbies: [], setupAllowed: false };
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
  'cubbies.addDevice'(ctx, c, msg) {
    try { ctx.cubbies.addDevice(signedInFloor(ctx, c).id, c.accountId!, msg.id, msg.publicKey, msg.label); }
    catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'cubbies.device'(ctx, c, msg) {
    try { ctx.cubbies.device(signedInFloor(ctx, c).id, c.accountId!, msg.id, msg); }
    catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'cubbies.knock'(ctx, c, msg) {
    try {
      const floor = signedInFloor(ctx, c);
      const { owner, by } = ctx.cubbies.knock(floor.id, c.accountId!, msg.id, c.id);
      for (const client of ctx.clients.values()) if (!client.out && client.accountId === owner) {
        ctx.sendTo(client, { t: 'cubbies.knocked', id: msg.id, by });
      }
    } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'cubbies.admit'(ctx, c, msg) {
    try {
      const floor = signedInFloor(ctx, c);
      const clients = ctx.cubbies.admit(floor.id, c.accountId!, msg.id, msg.accountId, msg.allow);
      for (const id of clients) {
        const client = ctx.clients.get(id);
        if (client && !client.out) ctx.sendTo(client, { t: 'cubbies.answer', id: msg.id, allow: msg.allow });
      }
    } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'cubbies.leave'(ctx, c, msg) {
    if (typeof msg.id === 'string') ctx.cubbies.leave(c.id, msg.id);
  },
  'cubbies.sendTask'(ctx, c, msg) {
    // Sign-in can finish asynchronously: check ownership and the floor again before enqueueing.
    const validate = () => {
      const floor = signedInFloor(ctx, c);
      return ctx.cubbies.task(floor.id, c.accountId!, msg.id, msg.title, msg.prompt);
    };
    try {
      const task = validate();
      addQueueTask(ctx, c, { t: 'queue.add', ...task },
        () => ctx.sendTo(c, { t: 'cubbies.taskSent', id: msg.id, title: task.title }),
        () => { try { validate(); return true; } catch (e) { ctx.warn(c, (e as Error).message); return false; } });
    } catch (e) { ctx.warn(c, (e as Error).message); }
  },
} satisfies HandlerMap<CubbiesClientMsg>;

function signedInFloor(ctx: Ctx, c: Client) {
  const floor = ctx.floorOf(c);
  if (c.out || !c.accountId || !floor) throw Error('Sign in on the cubby’s floor first');
  return floor;
}
export const cubbiesHooks: FeatureHooks = {
  leaving(ctx, c) {
    if (!ctx.cubbies?.enabled) return;
    ctx.cubbies.leave(c.id);
    return () => cubbiesChanged(ctx);
  },
  closed: (ctx, c) => ctx.cubbies?.leave(c.id),
};
