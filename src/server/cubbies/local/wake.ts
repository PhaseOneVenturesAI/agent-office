import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { CubbyAgent } from '../../../shared/protocol/cubbies.js';
import { jsonFile, type Run } from './io.js';

// What changed while the computer was asleep (or the connector stopped), said once when its cubby
// comes back: who finished, who started, who needs you, and how many commits landed on the project's
// branch. Worked out here from what the cubby already shows, never from transcripts.

/** How long the cubby must have been away before waking up gets a summary. */
export const ASLEEP_MS = 2 * 60_000;

export interface Seen { at: number; head?: string; agents: Pick<CubbyAgent, 'id' | 'tool' | 'role' | 'task' | 'status'>[] }

const file = (state: string) => path.join(state, 'last-seen.json');

export function loadSeen(state: string): Seen | undefined {
  try {
    const s = jsonFile(file(state), 64 * 1024);
    return typeof s.at === 'number' && Array.isArray(s.agents) ? s : undefined;
  } catch { return undefined; }
}

export function saveSeen(state: string, seen: Seen): void {
  const tmp = `${file(state)}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(seen), { mode: 0o600 });
    renameSync(tmp, file(state));
  } catch { /* the next snapshot tries again */ }
}

export async function headOf(project: string, execute: Run): Promise<string | undefined> {
  try { return (await execute('git', ['rev-parse', 'HEAD'], project)).trim() || undefined; } catch { return undefined; }
}

export async function commitsSince(project: string, from: string | undefined, to: string | undefined, execute: Run): Promise<number | undefined> {
  if (!from || !to || !/^[0-9a-f]{40}$/.test(from) || !/^[0-9a-f]{40}$/.test(to)) return undefined;
  if (from === to) return 0;
  try { return Number((await execute('git', ['rev-list', '--count', `${from}..${to}`], project)).trim()) || 0; } catch { return undefined; }
}

const label = (a: Seen['agents'][number]) => `${a.task || a.tool} (${a.tool})`;
const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : xs.join(', '));
const span = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
};

/** The summary for waking up after `before`, or undefined when it wasn't away long enough. */
export function wakeSummary(before: Seen | undefined, agents: readonly CubbyAgent[], now: number, commits?: number): string | undefined {
  if (!before || now - before.at < ASLEEP_MS) return undefined;
  const helpers = (xs: readonly Seen['agents'][number][]) => xs.filter((a) => a.role !== 'lead');
  const was = new Map(helpers(before.agents).map((a) => [a.id, a]));
  const is = new Map(helpers(agents).map((a) => [a.id, a]));
  const finished = [...was.values()].filter((a) => !is.has(a.id)).map(label);
  const started = [...is.values()].filter((a) => !was.has(a.id)).map(label);
  const needs = [...is.values()].filter((a) => a.status === 'needs-you' && was.get(a.id)?.status !== 'needs-you').map(label);
  const parts: string[] = [];
  if (finished.length) parts.push(`finished: ${list(finished)}`);
  if (started.length) parts.push(`started: ${list(started)}`);
  if (needs.length) parts.push(`needs you: ${list(needs)}`);
  if (commits) parts.push(`${commits} new commit${commits === 1 ? '' : 's'} on the project branch`);
  const still = [...is.values()].filter((a) => was.has(a.id)).length;
  if (still) parts.push(`${still} still working`);
  const away = `Back after ${span(now - before.at)} away`;
  return parts.length ? `${away}. ${parts.join('; ')}.`.slice(0, 600) : `${away}. Nothing changed while it was asleep.`;
}
