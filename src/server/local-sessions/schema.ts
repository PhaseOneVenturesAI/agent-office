import { LOCAL_ID, LOCAL_STATES, type LocalSnapshot } from '../../shared/protocol/local-sessions.js';

/** Reconstruct an allowlisted value on both sides of the wire; never spread a CLI result. */
export function readSnapshot(value: unknown, now = Date.now()): LocalSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.observedAt) || (v.observedAt as number) <= 0 || (v.observedAt as number) > now + 30_000) return;
  if (!['ok', 'partial', 'unavailable'].includes(String(v.collection)) || !Array.isArray(v.sessions) || v.sessions.length > 100) return;
  const sessions: LocalSnapshot['sessions'] = [];
  const seen = new Set<string>();
  for (const row of v.sessions) {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    if (![r.floorId, r.workspaceId, r.terminalId].every((s) => typeof s === 'string' && LOCAL_ID.test(s))) return;
    if (!LOCAL_STATES.includes(r.state as never) || !['claude', 'codex', 'kimi', 'unknown'].includes(String(r.provider)) || typeof r.exited !== 'boolean') return;
    if (r.lastEventAt !== null && (!Number.isSafeInteger(r.lastEventAt) || (r.lastEventAt as number) <= 0 || (r.lastEventAt as number) > (v.observedAt as number) + 30_000)) return;
    const key = `${r.workspaceId}:${r.terminalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    sessions.push({ floorId: r.floorId as string, workspaceId: r.workspaceId as string, terminalId: r.terminalId as string, state: r.state as LocalSnapshot['sessions'][number]['state'], provider: r.provider as LocalSnapshot['sessions'][number]['provider'], lastEventAt: r.lastEventAt as number | null, exited: r.exited });
  }
  return { observedAt: v.observedAt as number, collection: v.collection as LocalSnapshot['collection'], sessions };
}
