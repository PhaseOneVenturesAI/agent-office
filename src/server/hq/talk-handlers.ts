import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import type { HQTalkClientMsg } from '../../shared/protocol/hq.js';
import { leadsFor } from './leads.js';
import { messages } from './messages.js';
import { talkChanged, talkView } from './talk-views.js';
import { hqChanged } from './views.js';
export function sendTalk(ctx: Ctx, c: Client, leadId: string, text: unknown, from?: string) {
  if (c.out || !ctx.hq?.owns(c.accountId)) throw Error('Only Jonathan can talk to his leads directly');
  const owner = c.accountId!, lead = leadsFor(ctx, owner, true).find(l => l.id === leadId && l.mac);
  if (!lead || !ctx.hq.mac) throw Error('No linked lead');
  if (ctx.hq.mac.projects(owner)?.find(p => p.name === lead.project)?.localState === 'draft' && !ctx.hq.studio?.enabled(owner)) throw Error('Studio requires the HQ owner signed in through Cloudflare');
  return ctx.hq.mac.talk.submit(owner, lead, text, from ?? ctx.accounts.get(owner)!.name);
}
export function passTalk(ctx: Ctx, c: Client, id: string) {
  if (c.out || !ctx.hq?.owns(c.accountId)) throw Error('Only the owner can decide');
  const item = messages(ctx).waiting(id, c.accountId!);
  let leadId = item.lead;
  if (leadId.startsWith('cubby:')) {
    const room = ctx.cubbies.records.rows.get(leadId.slice(6));
    const lead = room && room.owner === c.accountId && leadsFor(ctx, c.accountId!, true).find(l => l.mac && l.floorId === room.floorId && l.departmentIndex === undefined);
    if (!lead) throw Error('Link this project on your Mac before passing on its message');
    leadId = lead.id;
  }
  const line = sendTalk(ctx, c, leadId, item.text, `${item.manager} (held, passed on by ${ctx.accounts.get(c.accountId!)!.name})`);
  if (line.state === 'failed') throw Error(line.error ?? 'Your Mac link is offline');
  messages(ctx).decide(id, c.accountId!, 'passed');
  hqChanged(ctx);
}
export const talkHandlers = {
  'hq.talk'(ctx, c, m) { try { sendTalk(ctx, c, m.lead, m.text); talkChanged(ctx); } catch (e) { ctx.warn(c, (e as Error).message); } },
  'hq.pass'(ctx, c, m) { try { passTalk(ctx, c, m.id); } catch (e) { ctx.warn(c, (e as Error).message); } },
  'hq.leads.get'(ctx, c) { ctx.sendTo(c, { t: 'hq.leads', view: talkView(ctx, c) }); },
} satisfies HandlerMap<HQTalkClientMsg>;
