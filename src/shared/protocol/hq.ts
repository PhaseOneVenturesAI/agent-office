import type { CubbyInfo } from './cubbies.js';
import type { OwnerColor } from '../personal-agents/appearance.js';
/** Deliberately excludes registry paths, sessions, apps and live work status. */
export interface HQProject {
  own?: true;
  repo?: string;
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
  leads?: HQLead[];
}
/** Existing HQ furniture capacity; overflow remains in its cubby until it has a desk. */
export const HQ_FURNISHED_PROJECTS = 6;
export type LeadWhere = 'hq' | 'project' | 'pitch';
export interface HQLead {
  id: string; project: string; projectIndex: number; departmentIndex?: number;
  role: string; title: string; computer: string; where: LeadWhere;
  floorId?: string; cubby?: CubbyInfo; needsYou: boolean;
}
/** Only sent to HQ's owner/managers, on this cubby's source floor. */
export interface HQLeadAway { hqFloorId: string; lead: HQLead }
export type HQServerMsg = { t: 'hq'; view?: HQView };
const label = (v: unknown, n: number) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
export function cleanProjects(raw: unknown): HQProject[] {
  if (!Array.isArray(raw)) return [];
  let ownSeen = false;
  return raw.slice(0, 12).flatMap(p => {
    if (!p || typeof p !== 'object' || typeof p.hasMainLead !== 'boolean' || !Array.isArray(p.departmentLeads)) return [];
    const name = label(p.name, 60);
    if (!name) return [];
    const repo = typeof p.repo === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(p.repo) ? p.repo : undefined;
    const own = p.own === true && !ownSeen;
    if (own) ownSeen = true;
    return [{ ...(own ? { own: true as const } : {}), ...(repo ? { repo } : {}), name, hasMainLead: p.hasMainLead, departmentLeads: p.departmentLeads.slice(0, 8).flatMap((d: unknown) => {
      if (!d || typeof d !== 'object') return [];
      const r = d as Record<string, unknown>, department = label(r.department, 40), title = label(r.title, 60);
      return department && title ? [{ department, title }] : [];
    }) }];
  });
}
