import { createHash } from 'node:crypto';
import { activityLine, cleanHQActivity, HELPER_CAP, HELPER_TTL_MS, WORK_STALE_MS, workLabel, workTargetKey, type HQActivity } from '../../shared/protocol/live-work.js';
import type { TalkTarget } from '../../shared/protocol/lead-talk.js';
import type { MacConfig } from '../hq/local/config.js';
import type { Activity } from './activity.js';
import type { TalkClock } from './talk.js';
import { activityTarget } from './live-targets.js';

const systemClock: TalkClock = { now: Date.now, after(fn, ms) { const t = setTimeout(fn, ms); t.unref(); return () => clearTimeout(t); } };
interface Lead {
  target: TalkTarget; identity: Activity; doing?: string; last: number; touched: number;
  helpers: Map<string, { id: string; title: string; at: number }>;
  cancel?: () => void;
}
/** A bounded local reducer, coalescing at the sending edge. No raw event is ever serialized. */
export class LiveActivity {
  private leads = new Map<string, Lead>();
  private cancelSweep: () => void;
  private closed = false;
  constructor(private resolve: (e: Activity) => TalkTarget | undefined, private send: (f: HQActivity) => unknown, private clock: TalkClock = systemClock) {
    const sweep = () => { this.sweep(); if (!this.closed) this.cancelSweep = this.clock.after(sweep, 1000); };
    this.cancelSweep = this.clock.after(sweep, 1000);
  }
  activity = (event: Activity) => {
    if (this.closed) return;
    const target = this.resolve(event); if (!target) return;
    const key = workTargetKey(target), now = this.clock.now();
    let lead = this.leads.get(key);
    if (!lead) {
      if (this.leads.size >= 109) return; // 12 × (CEO + 8 departments), plus Cofounder.
      lead = { target, identity: { schema: 1, event: 'SessionStart', sessionId: event.sessionId, appSession: event.appSession }, last: -Infinity, touched: now, helpers: new Map() }; this.leads.set(key, lead);
    }
    if (lead.identity.sessionId !== event.sessionId) { lead.helpers.clear(); lead.doing = undefined; }
    lead.identity = { schema: 1, event: 'SessionStart', sessionId: event.sessionId, appSession: event.appSession };
    lead.touched = now;
    if (event.event === 'Stop' || event.event === 'SessionStart') { lead.doing = undefined; lead.helpers.clear(); }
    if (event.event === 'PreToolUse' || event.event === 'PostToolUse') lead.doing = activityLine(event.summary, event.tool);
    if (event.agentId && (event.event === 'SubagentStart' || event.event === 'SubagentStop')) {
      const id = createHash('sha256').update(event.agentId).digest('hex').slice(0, 32);
      if (event.event === 'SubagentStop') lead.helpers.delete(id);
      else if (lead.helpers.has(id) || lead.helpers.size < HELPER_CAP) lead.helpers.set(id, { id, title: workLabel(event.agentType) || 'Helper', at: now });
    }
    this.queue(lead);
  };
  private queue(lead: Lead) {
    if (lead.cancel) return;
    const wait = Math.max(0, lead.last + 1000 - this.clock.now());
    if (!wait) this.flush(lead);
    else lead.cancel = this.clock.after(() => { lead.cancel = undefined; this.flush(lead); }, wait);
  }
  private flush(lead: Lead) {
    const target = this.resolve(lead.identity);
    if (!target || workTargetKey(target) !== workTargetKey(lead.target)) { this.leads.delete(workTargetKey(lead.target)); return; }
    lead.last = this.clock.now();
    const frame = cleanHQActivity({ t: 'hq.activity', target: lead.target, doing: lead.doing,
      helpers: [...lead.helpers.values()].map(h => ({ id: h.id, title: h.title, kind: 'subagent' })) });
    if (frame) this.send(frame);
  }
  sweep() {
    const now = this.clock.now();
    for (const [key, lead] of this.leads) {
      let expired = false;
      for (const [id, helper] of lead.helpers) if (now - helper.at >= HELPER_TTL_MS) { lead.helpers.delete(id); expired = true; }
      if (lead.doing && now - lead.touched >= WORK_STALE_MS) { lead.doing = undefined; expired = true; }
      // Keep long-running helpers visible without keeping an old tool line alive.
      if (expired || lead.helpers.size && now - lead.last >= 60_000) this.queue(lead);
      if (!lead.helpers.size && now - lead.touched > HELPER_TTL_MS && !lead.cancel) this.leads.delete(key);
    }
  }
  close() { this.closed = true; this.cancelSweep(); for (const lead of this.leads.values()) lead.cancel?.(); this.leads.clear(); }
}
export const linkLiveActivity = (config: MacConfig, send: (f: HQActivity) => unknown) => new LiveActivity(e => activityTarget(config, e), send);
