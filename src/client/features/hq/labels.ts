import type { HQProject } from '../../../shared/protocol/hq';

/** Default role titles add no information; preserve custom department titles. */
export function departmentLabel(d: HQProject['departmentLeads'][number]) {
  return d.title.trim().toLowerCase() === `${d.department} lead`.toLowerCase() ? d.department : `${d.department} · ${d.title}`;
}
