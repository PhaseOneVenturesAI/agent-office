import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { HQTalkView } from '../../shared/protocol/hq.js';
import { hqAccess, leadsFor } from './leads.js';
import { messageLeads } from './messages.js';
/** Owners/managers get their portfolio; coworkers get only the linked leads on their floor. */
export function talkView(ctx: Ctx, c: Client): HQTalkView | undefined {
  if (c.out || !c.accountId || !ctx.hq?.enabled) return;
  const owner = ctx.hq.mac?.owner();
  if (!owner) return;
  const access = hqAccess(ctx, c), mine = ctx.hq.owns(c.accountId);
  let leads = leadsFor(ctx, owner, mine).filter(l => l.mac);
  if (!access) leads = leads.filter(l => l.floorId === ctx.floorOf(c)?.id);
  if (!leads.length) return;
  if (access) leads = messageLeads(ctx, c, owner, leads, true);
  return { ownerName: ctx.hq.ownerName, ownerColor: ctx.cubbies.records.color(owner), mine, manager: !!access && !mine, leads };
}
const last = new WeakMap<Client, string>();
export function talkChanged(ctx: Ctx) {
  for (const c of ctx.clients.values()) {
    const view = talkView(ctx, c), key = JSON.stringify(view) ?? '';
    if (last.get(c) === key) continue;
    last.set(c, key); ctx.sendTo(c, { t: 'hq.leads', view });
  }
}
