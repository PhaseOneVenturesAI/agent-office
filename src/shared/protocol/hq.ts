import type { OwnerColor } from '../personal-agents/appearance.js';
/** Deliberately excludes registry paths, sessions, apps and live work status. */
export interface HQProject {
  name: string;
  hasMainLead: boolean;
  departmentLeads: { department: string; title: string }[];
}
export interface HQView {
  floorId: string;
  ownerName: string;
  ownerColor: OwnerColor;
  mine: boolean;
  projects: HQProject[];
}
export type HQServerMsg = { t: 'hq'; view?: HQView };
const label = (v: unknown, n: number) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
export function cleanProjects(raw: unknown): HQProject[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap(p => {
    if (!p || typeof p !== 'object' || typeof p.hasMainLead !== 'boolean' || !Array.isArray(p.departmentLeads)) return [];
    const name = label(p.name, 60);
    if (!name) return [];
    return [{ name, hasMainLead: p.hasMainLead, departmentLeads: p.departmentLeads.slice(0, 8).flatMap((d: unknown) => {
      if (!d || typeof d !== 'object') return [];
      const r = d as Record<string, unknown>, department = label(r.department, 40), title = label(r.title, 60);
      return department && title ? [{ department, title }] : [];
    }) }];
  });
}
