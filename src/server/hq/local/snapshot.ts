import { sessionStatuses } from './sessions.js';
import { localDesign } from '../../cubbies/local/design.js';
import { boundMacSnapshot } from './bounds.js';
import type { DesignImage } from '../../drafts/image-format.js';
import path from 'node:path';
import { cleanProjects } from '../../../shared/protocol/hq.js';
import { projectScope } from '../../cubbies/local/config.js';
import { canonical, jsonFile, run, type Run } from '../../cubbies/local/io.js';
import { presence, runsDir } from '../../cubbies/local/presence.js';
import { needsFor, readNeeds } from '../../cubbies/local/needs.js';
import { localPitch } from '../../cubbies/local/pitch.js';
import { githubRepo } from '../projects.js';
import { originRepo } from './origin.js';
import { type MacSnapshot } from '../wire.js';
import type { MacConfig } from './config.js';

/** Read only the v8 registry allowlist. In particular no prose/history object is traversed. */
export function macEntries(registry: unknown) {
  const projects = (registry as { projects?: unknown })?.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return [];
  return Object.entries(projects).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== 'object') return [];
    const p = raw as Record<string, unknown>;
    if (p.office === 'hidden' || p.localState === 'archived' || p.localState === 'remote-only' || !canonical(p.path)) return [];
    const departments = p.departmentLeads;
    const rows = Array.isArray(departments) ? departments.map(d => ['', d] as const)
      : departments && typeof departments === 'object' ? Object.entries(departments) : [];
    const lead = p.leadSessionId ?? p.leadThreadId;
    const cleanedDepartments = rows.slice(0, 8).flatMap(([key, d]) => {
      if (!d || typeof d !== 'object') return [];
      const r = d as Record<string, unknown>;
      const clean = cleanProjects([{ name: 'local', hasMainLead: false, departmentLeads: [{ department: r.department ?? key, title: r.title, lead: r.sessionId }] }])[0]?.departmentLeads[0];
      return clean ? [{ clean, ids: [r.sessionId, r.appSession] }] : [];
    });
    const project = cleanProjects([{ name, repo: githubRepo(p.url) ?? originRepo(p.path), lead,
      hasMainLead: !!(lead || p.leadAppSession), departmentLeads: cleanedDepartments.map(d => d.clean) }])[0];
    return project ? [{ path: p.path as string, project, sessions: [p.leadSessionId, p.leadAppSession],
      departments: cleanedDepartments }] : [];
  }).slice(0, 12);
}
export async function macSnapshot(config: MacConfig, deps: { run?: Run; isAlive?: (pid: number) => boolean; images?: Map<number, Map<string, DesignImage>> } = {}): Promise<MacSnapshot> {
  const frame: MacSnapshot = { t: 'hq.snapshot', computerId: config.computerId, observedAt: Date.now(), projects: [] };
  deps.images?.clear();
  const entries = macEntries(jsonFile(config.projectsFile, 256 * 1024));
  const status = sessionStatuses(config.home, deps.isAlive);
  const needs = readNeeds(path.join(config.home, 'Library/Application Support/AgentHarness/needs.json'));
  const seen = new Set<string>();
  const deadline = Date.now() + 8000; let calls = 0;
  const execute: Run = (bin, args, cwd) => {
    if (++calls > 24 || Date.now() > deadline) return Promise.reject(Error('HQ observation budget reached'));
    return (deps.run ?? run)(bin, args, cwd);
  };
  for (const entry of entries) {
    let scope;
    try { scope = await projectScope(entry.path, execute); } catch { continue; }
    let agents: ReturnType<typeof presence> = [];
    try { agents = presence(scope.roots, runsDir(config.home), deps.isAlive); } catch { /* next observation retries */ }
    const workers = agents.map(a => a.agent).filter(a => !seen.has(a.id)).slice(0, 64 - seen.size);
    workers.forEach(a => seen.add(a.id));
    const project = { ...entry.project, leadStatus: status(entry.sessions), departmentLeads: entry.project.departmentLeads.map((d, i) => ({ ...d, leadStatus: status(entry.departments[i]?.ids ?? []) })), needs: needsFor(needs, entry.path, scope.roots) };
    let pitch;
    try { const local = localPitch(entry.path); pitch = local.pitch; deps.images?.set(frame.projects.length, local.images); } catch { /* no published pitch */ }
    let draft;
    try { draft = localDesign(entry.path).boards; } catch { /* no draft board */ }
    frame.projects.push({ project, agents: workers, ...(pitch ? { pitch } : {}), ...(draft ? { draft } : {}) });
  }
  return boundMacSnapshot(frame);
}
