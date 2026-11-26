import path from 'node:path';
import { cleanProjects, type HQProject } from '../../shared/protocol/hq.js';
import { jsonFile } from '../cubbies/local/io.js';
/** Read-only, bounded registry projection. The caller supplies the configured registry location. */
export function readProjects(file: string): HQProject[] {
  const registry = jsonFile(file, 256 * 1024);
  if (!registry?.projects || typeof registry.projects !== 'object' || Array.isArray(registry.projects)) return [];
  return cleanProjects(Object.values(registry.projects).slice(0, 12).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const p = raw as Record<string, unknown>;
    const departments = p.departmentLeads;
    const entries = Array.isArray(departments) ? departments.map(d => ['', d] as const)
      : departments && typeof departments === 'object' ? Object.entries(departments) : [];
    return [{ name: typeof p.name === 'string' && p.name.trim() ? p.name : typeof p.path === 'string' ? path.basename(p.path) : '',
      hasMainLead: !!(typeof p.leadSessionId === 'string' && p.leadSessionId || typeof p.leadThreadId === 'string' && p.leadThreadId),
      departmentLeads: entries.flatMap(([key, raw]) => {
        if (!raw || typeof raw !== 'object') return [];
        const d = raw as Record<string, unknown>;
        return [{ department: typeof d.department === 'string' ? d.department : key, title: d.title ?? d.leadTitle }];
      }) }];
  }));
}
