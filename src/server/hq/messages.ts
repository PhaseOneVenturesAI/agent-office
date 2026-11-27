import { randomUUID } from 'node:crypto';
import type { HQLead, HQMessage, HQPassMessage } from '../../shared/protocol/hq.js';
import { managerMessageText, HQ_MESSAGE_CAP } from '../../shared/protocol/hq.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { ownerFingerprint, verifyOwner } from '../cubbies/wire.js';
import { hqAccess, leadsFor } from './leads.js';
import { cubbiesChanged } from '../ws/handlers/cubbies.js';

export const MESSAGE_TTL = 24 * 60 * 60 * 1000;
type Held = HQMessage & { managerId: string; owner: string };
/** Memory only. Terminal states remain visible for one further day, then are discarded. */
export class HQMessages {
  private items = new Map<string, Held>();
  private last = new Map<string, number>();
  constructor(private now = Date.now) {}
  sweep() {
    let changed = false;
    for (const [id, item] of this.items) {
      if (this.now() - item.at >= MESSAGE_TTL && item.state === 'waiting') { item.state = 'expired'; changed = true; }
      if (this.now() - item.at >= 2 * MESSAGE_TTL) { this.items.delete(id); changed = true; }
    }
    for (const [id, at] of this.last) if (this.now() - at >= 30_000) this.last.delete(id);
    return changed;
  }
  send(owner: string, managerId: string, manager: string, lead: string, raw: unknown) {
    this.sweep();
    const text = typeof raw === 'string' ? raw.trim().slice(0, HQ_MESSAGE_CAP) : '';
    if (!text) throw Error('Write a message first');
    if ([...this.items.values()].filter(i => i.managerId === managerId && i.state === 'waiting').length >= 5) throw Error('You already have 5 waiting messages');
    if (this.last.has(managerId)) throw Error('Wait 30 seconds between messages');
    const item: Held = { id: randomUUID(), managerId, manager, owner, lead, text, at: this.now(), state: 'waiting' };
    this.items.set(item.id, item); this.last.set(managerId, this.now()); return item;
  }
  waiting(id: string, owner: string) {
    this.sweep();
    const item = this.items.get(id);
    if (!item || item.owner !== owner || item.state !== 'waiting') throw Error('No waiting message');
    return item;
  }
  visible(owner: string, viewer: string, lead: string): HQMessage[] {
    this.sweep();
    return [...this.items.values()].filter(i => i.owner === owner && i.lead === lead && (viewer === owner || i.managerId === viewer || i.state === 'passed'))
      .map(({ managerId, owner, ...item }) => ({ ...item }));
  }
}
const stores = new WeakMap<Ctx, HQMessages>();
export function messages(ctx: Ctx) {
  let store = stores.get(ctx);
  if (!store) { store = new HQMessages(); stores.set(ctx, store); }
  return store;
}
function accessOnHQ(ctx: Ctx, c: Client) {
  const access = hqAccess(ctx, c);
  if (!access || !ctx.hq.is(ctx.floorOf(c)?.id)) throw Error('Messages are available on HQ only');
  return access;
}
export function sendManagerMessage(ctx: Ctx, c: Client, leadId: string, text: unknown) {
  const access = accessOnHQ(ctx, c);
  if (access.mine) throw Error('Only HQ managers can send a held message');
  const lead = leadsFor(ctx, access.owner, false).find(l => l.id === leadId);
  if (!lead || (!lead.mac && (!lead.cubby?.interior || !lead.floorId))) throw Error('No connected HQ lead');
  const item = messages(ctx).send(access.owner, c.accountId!, ctx.accounts.get(c.accountId!)!.name, leadId, text);
  // No connector call: expiry only republishes the private projections.
  const timer = setTimeout(() => {
    messages(ctx).sweep(); cubbiesChanged(ctx);
    setTimeout(() => { messages(ctx).sweep(); }, MESSAGE_TTL).unref();
  }, MESSAGE_TTL); timer.unref();
  cubbiesChanged(ctx); return item;
}
export function declineManagerMessage(ctx: Ctx, c: Client, id: string) {
  const access = accessOnHQ(ctx, c);
  if (!access.mine) throw Error('Only the owner can decide');
  messages(ctx).waiting(id, access.owner).state = 'declined'; cubbiesChanged(ctx);
}
export function passManagerMessage(ctx: Ctx, c: Client, msg: HQPassMessage) {
  const access = accessOnHQ(ctx, c);
  if (!access.mine) throw Error('Only the owner can decide');
  const item = messages(ctx).waiting(msg.hqMessageId, access.owner);
  const lead = leadsFor(ctx, access.owner, true).find(l => l.id === item.lead);
  const it = lead?.cubby?.interior;
  if (!lead?.floorId || !it?.computerId || lead.cubby?.id !== msg.id) throw Error('No connected HQ lead');
  const text = managerMessageText(item);
  let trusted = false;
  try { trusted = !!it.ownerDevices?.some(d => d.fingerprint === ownerFingerprint(msg.ownerPublicKey)); } catch { /* Reject malformed keys. */ }
  if (!trusted || msg.requestId !== item.id || msg.text !== text || !Number.isSafeInteger(msg.at) || Math.abs(Date.now() - msg.at) > 60_000 ||
    !verifyOwner(msg.ownerPublicKey, { ...msg, cubbyId: msg.id, floorId: lead.floorId, computerId: it.computerId })) throw Error('Use your trusted device to pass on this message');
  // Ordinary owner chat, still verified independently by the connector. No HQ fields cross inward.
  ctx.cubbies.chat(lead.floorId, c.accountId!, msg.id, { text, requestId: msg.requestId, at: msg.at, ownerSig: msg.ownerSig });
  item.state = 'passed'; cubbiesChanged(ctx);
}
export function messageLeads(ctx: Ctx, c: Client, owner: string, leads: HQLead[], onHQ: boolean): HQLead[] {
  return leads.map(lead => {
    const items = messages(ctx).visible(owner, c.accountId!, lead.id);
    if (onHQ) return { ...lead, messages: items };
    if (!ctx.hq.owns(c.accountId)) return lead;
    const waiting = items.filter(i => i.state === 'waiting');
    return { ...lead, messageBadge: messageBadge(waiting) };
  });
}
export function messageBadge(items: HQMessage[]) {
  const waiting = items.filter(i => i.state === 'waiting');
  return waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'message' : 'messages'} from ${[...new Set(waiting.map(i => i.manager))].join(', ')}` : undefined;
}
