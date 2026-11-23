import type { DeliveryRun } from '../../shared/protocol/delivery.js';
import { gh } from '../github.js';

export interface DeliveryRef { repo: string; sha: string; dir: string; number: number }
export const validRepo = (s: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
export const validSha = (s: string) => /^[0-9a-f]{40}$/i.test(s);
export const refKey = (ref: DeliveryRef) => `${ref.repo.toLowerCase()}@${ref.sha.toLowerCase()}`;
export type RunsReader = (ref: DeliveryRef) => Promise<DeliveryRun[]>;

/** Read-only GET, not the GitHub module's mutation surface. No workflow logs/artifact bodies. */
export const readRuns: RunsReader = async (ref) => {
  if (!validRepo(ref.repo) || !validSha(ref.sha)) throw new Error('Repository or source commit is unavailable');
  const data = JSON.parse(await gh(['api', '--method', 'GET', `repos/${ref.repo}/actions/runs?head_sha=${ref.sha}&per_page=30`], ref.dir));
  return normalizeRuns(data, ref);
};

export function normalizeRuns(value: unknown, ref: DeliveryRef): DeliveryRun[] {
  const rows = (value as { workflow_runs?: unknown[] } | null)?.workflow_runs;
  if (!Array.isArray(rows)) throw new Error('Run metadata is unavailable');
  const seen = new Set<string>();
  return rows.slice(0, 30).flatMap((raw: any) => {
    if (!Number.isSafeInteger(raw?.id) || raw.id <= 0 || typeof raw.head_sha !== 'string' || raw.head_sha.toLowerCase() !== ref.sha.toLowerCase() || !Number.isSafeInteger(raw.run_attempt) || raw.run_attempt < 1) return [];
    const url = `https://github.com/${ref.repo}/actions/runs/${raw.id}`;
    const key = `${refKey(ref)}:${raw.id}:${raw.run_attempt}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, id: raw.id, attempt: raw.run_attempt, workflow: typeof raw.name === 'string' ? raw.name.slice(0, 100) : 'Workflow', event: typeof raw.event === 'string' ? raw.event.slice(0, 40) : 'unknown', url, headSha: ref.sha.toLowerCase(), status: ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(raw.status) ? raw.status : 'unknown', conclusion: ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure'].includes(raw.conclusion) ? raw.conclusion : null, updatedAt: Date.parse(raw.updated_at) || 0, configuration: 'incomplete' as const }];
  });
}
