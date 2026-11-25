import type { CubbyAgent, CubbyNodeFrame } from '../../shared/protocol/cubbies.js';
const roles = new Set(['lead', 'builder', 'reviewer', 'factory', 'paradev', 'direct']);
const statuses = new Set(['idle', 'working', 'needs-you', 'unknown']);
export const short = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max) : '';
const lines = (v: unknown) => Array.isArray(v) ? v.slice(0, 16).filter(x => typeof x === 'string').map(x => short(x, 300)) : [];
export function snapshot(raw: Record<string, unknown>, now: number): Extract<CubbyNodeFrame, {t: 'cubby.snapshot'}> | undefined {
  if (!Array.isArray(raw.agents) || raw.agents.length > 128 || typeof raw.observedAt !== 'number' || !Number.isFinite(raw.observedAt) || Math.abs(now - raw.observedAt) > 120_000) return;
  const agents: CubbyAgent[] = []; const ids = new Set<string>();
  for (const a of raw.agents) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^[\w:.-]{1,128}$/.test(a.id) || ids.has(a.id) || !roles.has(a.role) || !statuses.has(a.status)) return;
    ids.add(a.id);
    agents.push({ id: a.id, tool: short(a.tool, 40), role: a.role, task: a.role === 'direct' ? `${short(a.tool, 40)} session` : short(a.task, 160), branch: short(a.branch, 120), status: a.status,
      ...(a.role !== 'direct' && typeof a.progress === 'string' ? { progress: short(a.progress, 600) } : {}),
      ...(a.role === 'factory' && typeof a.deadlineAt === 'number' && Number.isFinite(a.deadlineAt) ? { deadlineAt: a.deadlineAt } : {}) });
  }
  return { t: 'cubby.snapshot', floorId: short(raw.floorId, 128), agents, observedAt: raw.observedAt, plan: lines(raw.plan), needsYou: lines(raw.needsYou), ...(typeof raw.error === 'string' ? { error: short(raw.error, 400) } : {}) };
}
