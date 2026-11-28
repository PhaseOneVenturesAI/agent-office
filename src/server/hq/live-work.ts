import { createHash } from 'node:crypto';
import { cleanHQActivity, workLabel, workTargetKey, WORK_STALE_MS, type HQActivity, type WorkHelper } from '../../shared/protocol/live-work.js';
import type { TalkTarget } from '../../shared/protocol/lead-talk.js';
import type { HQLead, HQProject } from '../../shared/protocol/hq.js';
import type { LeadSource } from './leads.js';
import { liveProjects } from './live.js';

export const leadWorkTarget = (lead: HQLead): TalkTarget => lead.id === 'cofounder' ? { cofounder: true } : { project: lead.project, ...(lead.departmentIndex !== undefined ? { department: lead.departmentIndex } : {}) };
/** Ephemeral and scoped to the admitted node; a new connection cannot inherit old activity. */
export class HQLiveWork {
  private rows = new Map<string, Map<string, { frame: HQActivity; at: number }>>();
  constructor(private now = Date.now) {}
  accept(node: string, raw: unknown, admitted: boolean, allowed: (target: TalkTarget) => boolean): boolean {
    const frame = cleanHQActivity(raw);
    if (!admitted || !frame || !allowed(frame.target)) return false;
    const rows = this.rows.get(node) ?? new Map();
    const key = workTargetKey(frame.target);
    if (!rows.has(key) && rows.size >= 109) return false;
    rows.set(key, { frame, at: this.now() }); this.rows.set(node, rows); return true;
  }
  get(node: string | undefined, target: TalkTarget) {
    const row = node ? this.rows.get(node)?.get(workTargetKey(target)) : undefined;
    return row && this.now() - row.at < WORK_STALE_MS ? row.frame : undefined;
  }
  forget(node: string) { this.rows.delete(node); }
  sweep() {
    let changed = false;
    for (const [node, rows] of this.rows) {
      for (const [key, row] of rows) if (this.now() - row.at >= WORK_STALE_MS) { rows.delete(key); changed = true; }
      if (!rows.size) this.rows.delete(node);
    }
    return changed;
  }
}
/** Build helper rows from the very same desk assignment as the portfolio's workers. */
export function withLiveWork(leads: HQLead[], sources: LeadSource[], activity: (lead: HQLead) => HQActivity | undefined): HQLead[] {
  const projects = liveProjects(sources.flatMap(s => s.projects), sources);
  return leads.map(lead => {
    if (!lead.mac) return lead;
    const frame = activity(lead);
    const workers = projects.find(p => p.name === lead.project)?.workers ?? [];
    const helpers: WorkHelper[] = workers.filter(w => w.departmentIndex === lead.departmentIndex).map(w => ({
      id: createHash('sha256').update(w.id).digest('hex').slice(0, 32), title: workLabel(w.title) || 'Helper',
      kind: w.kind === 'factory' ? 'factory' : 'worker', doing: w.doing ?? (w.status === 'idle' ? 'idle' : 'working'),
    }));
    helpers.push(...frame?.helpers ?? []);
    return { ...lead, ...(frame?.doing ? { doing: frame.doing } : {}), helpers, working: helpers.length };
  });
}
/** Watch-only on a project floor. The redaction happens before serialization. */
export function projectWorkView(leads: HQLead[], canRead: boolean): HQLead[] {
  return canRead ? leads : leads.map(({ doing: _doing, helpers, ...lead }) => ({ ...lead,
    ...(helpers ? { helpers: helpers.map(({ doing: _line, ...helper }) => helper) } : {}) }));
}
/** Live board rows include lead tools and subagents; worker rows keep their existing order. */
export function liveWorkProjects(projects: HQProject[], leads: HQLead[]): HQProject[] {
  return projects.map(p => {
    const relevant = leads.filter(l => l.mac && l.project === p.name);
    if (!relevant.length) return p;
    const workers = [...p.workers ?? []];
    for (const l of relevant) {
      if (l.doing) workers.unshift({ id: `activity:${createHash('sha256').update(l.id).digest('hex').slice(0, 32)}`, title: l.role === 'CEO' ? 'Main lead' : l.title, provider: 'claude', role: l.role, branch: '', startedAt: 0, doing: l.doing, departmentIndex: l.departmentIndex });
      for (const h of l.helpers ?? []) if (h.kind === 'subagent') workers.push({ id: h.id, title: h.title, provider: 'claude', role: 'Helper', branch: '', startedAt: 0, kind: h.kind, doing: h.doing, departmentIndex: l.departmentIndex });
    }
    return { ...p, workers };
  });
}
