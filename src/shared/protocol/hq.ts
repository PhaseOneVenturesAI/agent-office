import type { CubbyInfo, CubbyOwnerMessage } from './cubbies.js';
import type { OwnerColor } from '../personal-agents/appearance.js';
/** Connector metadata is projected by publicProjects before reaching a browser. */
export interface HQProject {
  own?: true;
  lead?: string;
  needs?: HQNeeds;
  workers?: HQWorker[];
  repo?: string;
  name: string;
  hasMainLead: boolean;
  departmentLeads: { department: string; title: string; lead?: string }[];
}
export interface HQView {
  mac?: { computerName: string; connected: boolean; lastSeen: number };
  pitches?: (import('./pitch.js').PitchView & { project: string; projectIndex: number })[];
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
  mac?: boolean;
  working?: number;
  needs?: HQNeeds;
  messages?: HQMessage[];
  messageBadge?: string;
  id: string; project: string; projectIndex: number; departmentIndex?: number;
  role: string; title: string; computer: string; where: LeadWhere;
  floorId?: string; cubby?: CubbyInfo; needsYou: boolean;
}
/** Only sent to HQ's owner/managers, on this cubby's source floor. */
export interface HQLeadAway { hqFloorId: string; lead: HQLead; departments?: HQLead[] }
export type HQServerMsg = { t: 'hq.token'; token: string; floorId: string } | { t: 'hq'; view?: HQView } | { t: 'hq.gong'; project: string; pr: number };
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
    return [{ ...(own ? { own: true as const } : {}), ...(repo ? { repo } : {}), name, hasMainLead: p.hasMainLead, ...cleanLiveProject(p), departmentLeads: p.departmentLeads.slice(0, 8).flatMap((d: unknown) => {
      if (!d || typeof d !== 'object') return [];
      const r = d as Record<string, unknown>, department = label(r.department, 40), title = label(r.title, 60);
      return department && title ? [{ department, title, ...(leadId(r.lead) ? { lead: leadId(r.lead) } : {}) }] : [];
    }) }];
  });
}

export const HQ_MESSAGE_CAP = 4000;
export interface HQMessage {
  id: string; manager: string; lead: string; text: string; at: number;
  state: 'waiting' | 'passed' | 'declined' | 'expired';
}
export type HQPassMessage = { t: 'cubbies.chat'; id: string; hqMessageId: string; ownerPublicKey: string } & CubbyOwnerMessage;
export type HQClientMsg = { t: 'hq.pitch'; projectIndex: number } | { t: 'hq.setup' } | { t: 'hq.message'; lead: string; text: string } | { t: 'hq.decline'; id: string } | HQPassMessage;
export function managerMessageText(item: Pick<HQMessage, 'manager' | 'text'>) {
  return `Message from ${item.manager} (HQ manager; can't approve merges, publishes or spending): ${item.text}`;
}

export interface HQNeeds { open: number | null; items: string[]; stale: boolean; at: string }
export interface HQWorker { id: string; title: string; provider: string; role: string; branch: string; startedAt: number; departmentIndex?: number }
/** Reject invalid identity strings rather than turning them into another lead's identity. */
export const leadId = (v: unknown): string | undefined => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : undefined;
export function cleanNeeds(raw: unknown): HQNeeds | undefined {
  if (!raw || typeof raw !== 'object') return;
  const n = raw as Record<string, unknown>;
  if (!(n.open === null || typeof n.open === 'number' && Number.isSafeInteger(n.open) && n.open >= 0) ||
    typeof n.at !== 'string' || !Number.isFinite(Date.parse(n.at)) || typeof n.stale !== 'boolean' || !Array.isArray(n.items)) return;
  return { open: n.open as number | null, items: n.items.slice(0, 3).filter((s): s is string => typeof s === 'string').map(s => label(s, 160)), stale: n.stale, at: new Date(n.at).toISOString() };
}
function cleanLiveProject(p: Record<string, any>) {
  const needs = cleanNeeds(p.needs), lead = leadId(p.lead);
  const workers = Array.isArray(p.workers) ? p.workers.slice(0, 64).flatMap((w: any) => {
    if (!w || typeof w.id !== 'string' || !/^[\w:.-]{1,128}$/.test(w.id)) return [];
    return [{ id: w.id, title: label(w.title, 160), provider: label(w.provider, 40), role: label(w.role, 60), branch: label(w.branch, 120),
      startedAt: typeof w.startedAt === 'number' && Number.isFinite(w.startedAt) ? w.startedAt : 0,
      ...(Number.isInteger(w.departmentIndex) && w.departmentIndex >= 0 && w.departmentIndex < 8 ? { departmentIndex: w.departmentIndex } : {}) }];
  }) : undefined;
  return { ...(lead ? { lead } : {}), ...(needs ? { needs } : {}), ...(workers ? { workers } : {}) };
}
/** Owner-only prose; count and observation age remain visible to managers. */
export const visibleNeeds = (needs: HQNeeds | undefined, mine: boolean): HQNeeds | undefined => needs && { ...needs, items: mine ? needs.items : [] };
export function publicProjects(projects: HQProject[], mine: boolean): HQProject[] {
  return projects.map(({ lead: _lead, needs, departmentLeads, ...p }) => ({ ...p,
    departmentLeads: departmentLeads.map(({ lead: _id, ...d }) => d), ...(needs ? { needs: visibleNeeds(needs, mine) } : {}) }));
}
/** A short local time for people ("Nov 26, 06:16"); the ISO value stays in the data. */
export const asOf = (at: string) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export function needsLabel(n?: HQNeeds) {
  if (!n) return '';
  const count = n.open === null ? 'Needs you: unknown' : `${n.open} need you`;
  return `${count}${n.stale ? ` · stale · as of ${asOf(n.at)}` : ''}`;
}

/** Compact text for a two-line overhead plate; full observation time stays in the window. */
export function needsPlate(n?: HQNeeds) {
  if (!n || n.open === 0) return 'Needs you';
  return `${n.open ?? '?'} need you${n.stale ? ` · as of ${asOf(n.at)}` : ''}`;
}
