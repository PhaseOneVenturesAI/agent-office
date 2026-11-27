/**
 * v8 phase 2: talking to the owner's leads through the Mac link.
 * Frames ride the link's existing /ws/node connection. Session ids, paths and
 * sockets never leave the Mac: the office names a lead by project + department.
 */
export const TALK_TEXT_CAP = 4000;

/** `project` is the projects.json name as sent in the snapshot; omit `department` for the main lead. */
export type TalkTarget = { cofounder: true } | { project: string; department?: number };

/** Office → link. `from` is a display label: "Jonathan", or "Ivan H (held, passed on by Jonathan)". */
export interface LeadSend { t: 'lead.send'; id: string; target: TalkTarget; text: string; from: string }

export type LeadState = 'queued' | 'delivered' | 'working' | 'replied' | 'failed';
/** Link → office. `path` says how it was delivered; `error` is a short owner-facing sentence. */
export interface LeadStateFrame { t: 'lead.state'; id: string; state: Exclude<LeadState, 'replied'>; path?: 'inbox' | 'headless'; error?: string }
export interface LeadReply { t: 'lead.reply'; id: string; text: string }

export const TALK_ID = /^[a-f0-9-]{36}$/;
const clip = (v: unknown, n: number) => typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';

export function cleanTarget(raw: unknown): TalkTarget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.cofounder === true) return { cofounder: true };
  const project = clip(r.project, 60);
  if (!project) return undefined;
  if (r.department === undefined) return { project };
  return Number.isInteger(r.department) && (r.department as number) >= 0 && (r.department as number) < 8 ? { project, department: r.department as number } : undefined;
}

export function cleanLeadSend(raw: any): LeadSend | undefined {
  const target = cleanTarget(raw?.target), text = clip(raw?.text, TALK_TEXT_CAP), from = clip(raw?.from, 80);
  return raw?.t === 'lead.send' && TALK_ID.test(raw.id) && target && text && from ? { t: 'lead.send', id: raw.id, target, text, from } : undefined;
}

export function cleanLeadFrame(raw: any): LeadStateFrame | LeadReply | undefined {
  if (!raw || !TALK_ID.test(raw.id)) return undefined;
  if (raw.t === 'lead.reply') { const text = clip(raw.text, TALK_TEXT_CAP); return text ? { t: 'lead.reply', id: raw.id, text } : undefined; }
  if (raw.t !== 'lead.state' || !['queued', 'delivered', 'working', 'failed'].includes(raw.state)) return undefined;
  const error = clip(raw.error, 200);
  return { t: 'lead.state', id: raw.id, state: raw.state, ...(raw.path === 'inbox' || raw.path === 'headless' ? { path: raw.path } : {}), ...(error ? { error } : {}) };
}

/** The text a lead receives. Always says who it is from; never claims to be Jonathan's approval. */
export const deliveredText = (f: Pick<LeadSend, 'from' | 'text'>) => `From ${f.from} in Agent Office:\n${f.text}`;
