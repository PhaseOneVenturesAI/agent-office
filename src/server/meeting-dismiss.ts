import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Meeting } from '../shared/protocol.js';
import type { MeetingWorkers, MeetingTrees } from './meetings.js';

/** Cleanup follows successful stop of every seat. A failed stop retains meeting ownership. */
export async function dismissMeeting(m: Meeting, workers: MeetingWorkers, trees: MeetingTrees | undefined, dir: string, cwd: string,
  toast: (text: string, level: 'info' | 'warn') => void, persist: () => void): Promise<boolean> {
  if (m.cleared) return true;
  const here = new Set(workers.list().map((w) => w.id));
  const results = await Promise.allSettled(m.seats.filter((s) => s.workerId && here.has(s.workerId)).map((s) => workers.kill(s.workerId!)));
  const failures = results.flatMap((r) => r.status === 'rejected' ? [String(r.reason)] : r.value.error ? [r.value.error] : []);
  if (failures.length) {
    toast(`Kept the “${m.title}” meeting and workspace: ${failures.join('; ')}`, 'warn');
    persist(); return false;
  }
  const wt = m.worktree;
  if (wt && trees) {
    const own = path.resolve(dir, '.agent-office', 'worktrees') + path.sep;
    for (const leftover of [m.notes, m.pattern === 'review' ? m.output : undefined]) {
      const abs = leftover && path.resolve(cwd, leftover);
      if (abs && abs.startsWith(own)) rmSync(abs, { recursive: true, force: true });
    }
    const state = await trees.inspect(wt);
    if (state.error || state.dirty) toast(`Kept the “${m.title}” meeting's worktree and branch ${wt.branch}: ${state.error ?? `${state.dirty} uncommitted change${state.dirty === 1 ? '' : 's'}`}`, 'info');
    else {
      const error = await trees.remove(wt, state.ahead ? 'worktree' : 'all');
      if (error) toast(`Couldn't tidy away the meeting's worktree: ${error}`, 'warn');
    }
  }
  m.cleared = true;
  persist(); return true;
}
