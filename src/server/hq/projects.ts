import path from 'node:path';
import { cleanProjects, type HQProject } from '../../shared/protocol/hq.js';
import { needsFor, type NeedsRead } from '../cubbies/local/needs.js';
import { canonical, jsonFile } from '../cubbies/local/io.js';
/** Read-only, bounded registry projection. The caller supplies the configured registry location. */
export function readProjects(file: string, scope?: { project: string; roots: string[] }, needs?: NeedsRead): HQProject[] {
  const registry = jsonFile(file, 256 * 1024);
  if (!registry?.projects || typeof registry.projects !== 'object' || Array.isArray(registry.projects)) return [];
  return cleanProjects(Object.values(registry.projects).slice(0, 12).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const p = raw as Record<string, unknown>;
    if (p.office === 'hidden' || p.localState === 'archived' || p.localState === 'remote-only') return [];
    const departments = p.departmentLeads;
    const entries = Array.isArray(departments) ? departments.map(d => ['', d] as const)
      : departments && typeof departments === 'object' ? Object.entries(departments) : [];
    const registered = canonical(p.path);
    const own = !!scope && ((!!registered && scope.roots.includes(registered)) || p.path === scope.project);
    const repo = githubRepo(p.url);
    return [{ ...(own ? { own: true } : {}), ...(repo ? { repo } : {}), name: typeof p.name === 'string' && p.name.trim() ? p.name : typeof p.path === 'string' ? path.basename(p.path) : '',
      lead: p.leadThreadId ?? p.leadSessionId,
      ...(needs && typeof p.path === 'string' ? { needs: needsFor(needs, p.path, own ? scope?.roots : []) } : {}),
      hasMainLead: !!(typeof p.leadSessionId === 'string' && p.leadSessionId || typeof p.leadThreadId === 'string' && p.leadThreadId),
      departmentLeads: entries.flatMap(([key, raw]) => {
        if (!raw || typeof raw !== 'object') return [];
        const d = raw as Record<string, unknown>;
        return [{ department: typeof d.department === 'string' ? d.department : key, title: d.title ?? d.leadTitle, lead: d.sessionId }];
      }) }];
  }));
}

/** Only the repository slug crosses the connector; credentials, query and paths never do. */
export function githubRepo(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return;
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'github.com' || !['https:', 'http:'].includes(url.protocol)) return;
    const match = /^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
    if (match) return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
  } catch { /* Not a GitHub repository URL. */ }
}
