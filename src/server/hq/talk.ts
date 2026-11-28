import type { LeadReview } from '../../shared/protocol/lead-review.js';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanLeadFrame, cleanLeadSend, type LeadSend, type TalkTarget } from '../../shared/protocol/lead-talk.js';
import type { HQLead, HQTalkLine } from '../../shared/protocol/hq.js';

/** The link may wait 10 min for a busy lead, then 20 min for its reply; outlast both. */
export const PENDING_MS = 31 * 60_000;
export function talkTarget(lead: HQLead): TalkTarget {
  if (!lead.mac) throw Error('No linked lead');
  return lead.id === 'cofounder' ? { cofounder: true } : { project: lead.project, ...(lead.departmentIndex === undefined ? {} : { department: lead.departmentIndex }) };
}
export function privateJSON(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
  chmodSync(file + '.tmp', 0o600); renameSync(file + '.tmp', file);
}
type Thread = { owner: string; lead: string; lines: HQTalkLine[] };
type Pending = { owner: string; lead: string; node: string; at: number };
/** Persist before transport; a restart never replays a message into a lead session. */
export class HQTalk {
  private threads = new Map<string, Thread>();
  private pending = new Map<string, Pending>();
  private rate = new Map<string, number[]>();
  private file: string;
  constructor(dir: string, private owns: (owner?: string) => boolean,
    private node: (owner: string) => string | undefined,
    private send: (node: string, frame: LeadSend) => boolean,
    private changed: () => void, private now = Date.now) {
    this.file = path.join(dir, 'hq-talk.json');
    if (existsSync(this.file)) {
      const rows: Thread[] = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(rows)) throw Error('Invalid lead conversations');
      for (const row of rows) {
        if (!row || typeof row.owner !== 'string' || typeof row.lead !== 'string' || !Array.isArray(row.lines)) throw Error('Invalid lead conversation');
        row.lines = row.lines.slice(-50);
        for (const line of row.lines) if (!['replied', 'failed'].includes(line.state)) { line.state = 'failed'; line.error = 'Office restarted before a reply arrived'; }
        this.threads.set(this.key(row.owner, row.lead), row);
      }
      this.save();
    }
  }
  /** The Studio native session becomes this repo's main lead; retain its conversation. */
  promote(owner: string, before: string, after: string) {
    if (before === after) return;
    const old = this.threads.get(this.key(owner, before)); if (!old) return;
    const current = this.threads.get(this.key(owner, after));
    this.threads.set(this.key(owner, after), { owner, lead: after, lines: [...old.lines, ...(current?.lines ?? [])].sort((a,b) => a.at - b.at).slice(-50) });
    this.threads.delete(this.key(owner, before));
    for (const p of this.pending.values()) if (p.owner === owner && p.lead === before) p.lead = after;
    this.save();
  }
  private key(owner: string, lead: string) { return JSON.stringify([owner, lead]); }
  private save() { privateJSON(this.file, [...this.threads.values()]); }
  view(owner: string, lead: string, viewer: string | undefined) {
    if (owner !== viewer || !this.owns(viewer)) return undefined;
    return this.threads.get(this.key(owner, lead))?.lines.map(line => ({ ...line })) ?? [];
  }
  submit(owner: string | undefined, lead: HQLead, text: unknown, from: string, review?: LeadReview) {
    if (!owner || !this.owns(owner)) throw Error('Only Jonathan can talk to his leads directly');
    this.sweep();
    if ([...this.pending.values()].some(p => p.owner === owner && p.lead === lead.id)) throw Error('Wait for this lead to reply first');
    const recent = (this.rate.get(owner) ?? []).filter(at => this.now() - at < 60_000);
    if (recent.length >= 10) throw Error('Wait a minute before sending more messages');
    const frame = cleanLeadSend({ t: 'lead.send', id: randomUUID(), target: talkTarget(lead), text, from, review });
    if (!frame) throw Error('Write a message first');
    const key = this.key(owner, lead.id), thread = this.threads.get(key) ?? { owner, lead: lead.id, lines: [] };
    const line: HQTalkLine = { id: frame.id, role: 'user', text: frame.text, from: frame.from, at: this.now(), state: 'queued' };
    thread.lines.push(line); thread.lines = thread.lines.slice(-50); this.threads.set(key, thread);
    this.rate.set(owner, [...recent, this.now()]);
    const node = this.node(owner);
    if (!node) { line.state = 'failed'; line.error = 'Your Mac link is offline'; }
    else this.pending.set(line.id, { owner, lead: lead.id, node, at: this.now() });
    this.save();
    if (node && !this.send(node, frame)) { line.state = 'failed'; line.error = 'Your Mac link is offline'; this.pending.delete(line.id); this.save(); }
    this.changed(); return line;
  }
  /** A lead the office just started answered its first prompt: show that as the conversation's opening line. */
  greet(owner: string, lead: string, text: string) {
    if (!this.owns(owner) || !text.trim()) return;
    const key = this.key(owner, lead), thread = this.threads.get(key) ?? { owner, lead, lines: [] };
    thread.lines.push({ id: randomUUID(), role: 'assistant', text: text.slice(0, 4000), at: this.now(), state: 'replied', path: 'headless' });
    thread.lines = thread.lines.slice(-50); this.threads.set(key, thread); this.save(); this.changed();
  }
  accept(node: string, owner: string, raw: unknown) {
    const frame = cleanLeadFrame(raw), pending = frame && this.pending.get(frame.id);
    if (!frame || !pending || pending.node !== node || pending.owner !== owner || !this.owns(owner)) return false;
    const thread = this.threads.get(this.key(owner, pending.lead))!, line = thread.lines.find(l => l.id === frame.id && l.role === 'user')!;
    if (frame.t === 'lead.reply') {
      line.state = 'replied'; delete line.error;
      thread.lines.push({ id: frame.id, role: 'assistant', text: frame.text, at: this.now(), state: 'replied', ...(line.path ? { path: line.path } : {}) });
      thread.lines = thread.lines.slice(-50); this.pending.delete(frame.id);
    } else {
      const rank = { queued: 0, delivered: 1, working: 2, replied: 3, failed: 3 };
      if (rank[frame.state] < rank[line.state]) return false;
      line.state = frame.state;
      if (frame.path) line.path = frame.path;
      if (frame.error) line.error = frame.error;
      if (frame.state === 'failed') this.pending.delete(frame.id);
    }
    this.save(); this.changed(); return true;
  }
  sweep(online?: (node: string) => boolean) {
    let changed = false;
    for (const [id, p] of this.pending) {
      const offline = online && !online(p.node);
      if (!offline && this.now() - p.at < PENDING_MS) continue;
      const line = this.threads.get(this.key(p.owner, p.lead))?.lines.find(l => l.id === id);
      if (line) { line.state = 'failed'; line.error = offline ? 'Your Mac link is offline' : 'No reply arrived. Open in the Claude app'; }
      this.pending.delete(id); changed = true;
    }
    if (changed) { this.save(); this.changed(); }
  }
}
