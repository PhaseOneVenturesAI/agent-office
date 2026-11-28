import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { privateJSON } from './talk.js';
import { randomUUID } from 'node:crypto';
import type { HQLead, HQMessage } from '../../shared/protocol/hq.js';
import { HQ_MESSAGE_CAP } from '../../shared/protocol/hq.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { hqAccess, leadsFor } from './leads.js';
import { cubbiesChanged } from '../ws/handlers/cubbies.js';

export const MESSAGE_TTL = 24 * 60 * 60 * 1000;
type Held = HQMessage & { managerId: string; owner: string };
/** Persisted held queue. Terminal states remain visible for one further day, then are discarded. */
export class HQMessages {
  private items = new Map<string, Held>();
  private last = new Map<string, number>();
  private file?: string;
  constructor(private now = Date.now, dir?: string) {
    if (!dir) return;
    this.file = path.join(dir, 'hq-messages.json');
    if (existsSync(this.file)) {
      const rows: Held[] = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(rows)) throw Error('Invalid held messages');
      for (const item of rows) {
        if (!item || typeof item.id !== 'string' || typeof item.owner !== 'string' || typeof item.managerId !== 'string' || !Number.isFinite(item.at)) throw Error('Invalid held message');
        this.items.set(item.id, item);
        this.last.set(item.managerId, Math.max(this.last.get(item.managerId) ?? 0, item.at));
      }
      this.sweep(); this.save();
    }
  }
  private save() { if (this.file) privateJSON(this.file, [...this.items.values()]); }
  decide(id: string, owner: string, state: 'passed' | 'declined') { this.waiting(id, owner).state = state; this.save(); }
  sweep() {
    let changed = false;
    for (const [id, item] of this.items) {
      if (this.now() - item.at >= MESSAGE_TTL && item.state === 'waiting') { item.state = 'expired'; changed = true; }
      if (this.now() - item.at >= 2 * MESSAGE_TTL) { this.items.delete(id); changed = true; }
    }
    for (const [id, at] of this.last) if (this.now() - at >= 30_000) this.last.delete(id);
    if (changed) this.save();
    return changed;
  }
  send(owner: string, managerId: string, manager: string, lead: string, raw: unknown) {
    this.sweep();
    const text = typeof raw === 'string' ? raw.trim().slice(0, HQ_MESSAGE_CAP) : '';
    if (!text) throw Error('Write a message first');
    if ([...this.items.values()].filter(i => i.managerId === managerId && i.state === 'waiting').length >= 5) throw Error('You already have 5 waiting messages');
    if (this.last.has(managerId)) throw Error('Wait 30 seconds between messages');
    const item: Held = { id: randomUUID(), managerId, manager, owner, lead, text, at: this.now(), state: 'waiting' };
    this.items.set(item.id, item); this.last.set(managerId, this.now()); this.save(); return item;
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
  if (!store) { store = new HQMessages(Date.now, ctx.cfg?.dataDir ?? ctx.hq.mac?.dataDir); stores.set(ctx, store); }
  return store;
}
function accessOnHQ(ctx: Ctx, c: Client) {
  const access = hqAccess(ctx, c);
  if (!access || (!ctx.hq.is(ctx.floorOf(c)?.id) && (!access.mine || !ctx.hq.mac?.owner()))) throw Error('Messages are available on HQ only');
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
  messages(ctx).decide(id, access.owner, 'declined'); cubbiesChanged(ctx);
}
export function messageLeads(ctx: Ctx, c: Client, owner: string, leads: HQLead[], onHQ: boolean): HQLead[] {
  return leads.map(lead => {
    const ids = [lead.id, ...lead.mac && lead.departmentIndex === undefined && lead.floorId ? [...ctx.cubbies.records.rows.values()]
      .filter(r => r.owner === owner && r.floorId === lead.floorId).map(r => `cubby:${r.id}`) : []];
    const items = ids.flatMap(id => messages(ctx).visible(owner, c.accountId!, id));
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
