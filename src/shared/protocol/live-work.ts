import { cleanTarget, type TalkTarget } from './lead-talk.js';

export interface WorkHelper { id: string; title: string; kind: 'subagent' | 'worker' | 'factory'; doing?: string }
/** Complete replacement for one lead, not a delta. Only opaque helper identities cross this boundary. */
export interface HQActivity { t: 'hq.activity'; target: TalkTarget; doing?: string; helpers: WorkHelper[] }
export const WORK_STALE_MS = 120_000, HELPER_TTL_MS = 30 * 60_000, HELPER_CAP = 8;
const identity = /(?:[a-f\d]{8}-[a-f\d-]{27,}|[a-f\d]{24,})/ig;
/** Display prose never carries path tokens or native identifiers. */
export function workLabel(value: unknown, cap = 80): string {
  return typeof value === 'string' ? value.replace(/\S*[\/\\]\S*/g, '').replace(identity, '')
    .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap) : '';
}
const word = (value: string) => workLabel(value.replace(/^.*[\/\\]/, '').replace(/^["']|["']$/g, ''), 64).match(/^[\w.@+-]+$/)?.[0] ?? '';
/** Summaries contain only tool + basename/command first word. Do not forward arguments. */
export function activityLine(summary: unknown, tool?: unknown): string | undefined {
  if (typeof summary !== 'string' && typeof tool !== 'string') return;
  const raw = typeof summary === 'string' ? summary.trim() : '';
  const match = raw.match(/^([\w.-]+)(?:\s*:\s*|\s+)?(.*)$/);
  const name = typeof tool === 'string' && tool ? tool : match?.[1] ?? '';
  const detail = match?.[1]?.toLowerCase() === name.toLowerCase() ? match[2] : raw;
  const token = word(detail.split(/\s+/)[0] ?? '');
  if (['Edit', 'Write', 'NotebookEdit', 'Read'].includes(name)) return token ? `${name === 'Read' ? 'reading' : 'editing'} ${token}` : `using ${name}`;
  if (name === 'Bash') return token ? `running ${/^(npm|node|pytest|python(?:3)?)$/.test(token) && /(?:^|[\s/_.-])(?:test\w*|pytest)(?:$|[\s/_.-])/.test(detail) ? 'tests' : token}` : 'using Bash';
  const safe = word(name);
  return safe ? `using ${safe}` : undefined;
}
/** Accept already rendered lines, never free-form commands or arbitrary prose. */
export function cleanDoing(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const m = value.match(/^(editing|reading|running|using) ([\w.@+-]{1,64})$/);
  return m && word(m[2]) === m[2] ? value : undefined;
}
export function cleanWorkHelper(raw: unknown): WorkHelper | undefined {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as WorkHelper, title = workLabel(r.title), doing = cleanDoing(r.doing);
  if (typeof r.id !== 'string' || !/^[a-f0-9]{32}$/.test(r.id) || !title || !['subagent', 'worker', 'factory'].includes(r.kind)) return;
  return { id: r.id, title, kind: r.kind, ...(doing ? { doing } : {}) };
}
export function cleanHQActivity(raw: unknown): HQActivity | undefined {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as HQActivity, target = cleanTarget(r.target), doing = cleanDoing(r.doing);
  if (r.t !== 'hq.activity' || !target || !Array.isArray(r.helpers) || r.helpers.length > HELPER_CAP ||
    ('project' in target && workLabel(target.project, 60) !== target.project)) return;
  const helpers = r.helpers.map(cleanWorkHelper);
  if (helpers.some(h => !h || h.kind !== 'subagent') || new Set(helpers.map(h => h!.id)).size !== helpers.length) return;
  return { t: 'hq.activity', target, ...(doing ? { doing } : {}), helpers: helpers as WorkHelper[] };
}
export const workTargetKey = (target: TalkTarget) => 'cofounder' in target ? 'cofounder' : JSON.stringify([target.project, target.department ?? null]);

/** Clean additive presence fields at the snapshot trust boundary. */
export function cleanPresenceWork(a: Record<string, unknown>) {
  const lastTool = cleanDoing(a.lastTool);
  return { ...(a.kind === 'worker' || a.kind === 'factory' ? { kind: a.kind as 'worker' | 'factory' } : {}),
    ...(lastTool ? { lastTool } : {}),
    ...(typeof a.updatedAt === 'number' && Number.isFinite(a.updatedAt) && a.updatedAt >= 0 ? { updatedAt: a.updatedAt } : {}) };
}

/** Additional board fields survive the browser's cleanProjects boundary. */
export function cleanWorkerWork(w: Record<string, unknown>) {
  const doing = cleanDoing(w.doing) ?? (w.doing === 'working' || w.doing === 'idle' ? w.doing : undefined);
  return { ...(doing ? { doing } : {}),
    ...(w.status === 'working' || w.status === 'idle' ? { status: w.status as 'working' | 'idle' } : {}),
    ...(['worker', 'factory', 'subagent'].includes(String(w.kind)) ? { kind: w.kind as WorkHelper['kind'] } : {}) };
}
