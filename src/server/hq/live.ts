import type { HQProject, HQWorker } from '../../shared/protocol/hq.js';
import type { LeadSource } from './leads.js';

export const sameProject = (a: HQProject, b: HQProject) => a.repo && b.repo ? a.repo.toLowerCase() === b.repo.toLowerCase() : a.name === b.name;
/** Presence has already been scoped to exact Git worktree roots by the connector. */
export function liveWorkers(source?: LeadSource) {
  if (source?.mac) return Date.now() - source.observedAt > 60_000 ? [] : source.agents.filter(a => a.id.startsWith('harness:') && (a.status === 'working' || a.status === 'idle'));
  if (!source || source.cubby.lamp === 'asleep' || (source.cubby.interior?.observedAt !== undefined && Date.now() - source.cubby.interior.observedAt > 60_000)) return [];
  return (source.agents ?? source.cubby.interior?.agents ?? []).filter(a => a.id.startsWith('harness:') && (a.status === 'working' || a.status === 'idle'));
}
/** Each presence identity gets exactly one HQ desk, even if two connectors observe it. */
export function liveProjects(projects: HQProject[], sources: LeadSource[]): HQProject[] {
  const result = projects.map(p => ({ ...p, workers: [] as HQWorker[] }));
  const seen = new Set<string>();
  for (const source of sources) {
    const own = source.mac ? source.projects[0] : source.projects.find(p => p.own);
    const fallback = own && result.find(p => sameProject(p, own));
    for (const a of liveWorkers(source)) {
      if (seen.has(a.id)) continue;
      const matched = a.lead && result.find(p => (!source.mac || (own && sameProject(p, own))) && ( p.lead === a.lead || p.departmentLeads.some(d => d.lead === a.lead)));
      const project = matched || fallback;
      if (!project) continue;
      const departmentIndex = a.lead ? project.departmentLeads.findIndex(d => d.lead === a.lead) : -1;
      if (!source.mac && departmentIndex < 0 && !project.hasMainLead) continue;
      seen.add(a.id);
      project.workers.push({ ...(a.kind ? { kind: a.kind, status: a.status === 'idle' ? 'idle' : 'working', doing: a.lastTool ?? (a.status === 'idle' ? 'idle' : 'working') } : {}), id: a.id, title: a.task, provider: a.tool, role: a.harnessRole ?? a.role, branch: a.branch.replace(/^refs\/heads\//, ''),
        startedAt: a.startedAt ?? 0, ...(departmentIndex >= 0 ? { departmentIndex } : {}) });
    }
  }
  for (const p of result) {
    p.workers.sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
    if (!p.workers.length) delete (p as HQProject).workers;
  }
  return result;
}
