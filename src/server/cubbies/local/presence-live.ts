import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { activityLine, cleanDoing, workLabel } from '../../../shared/protocol/live-work.js';
import { alive } from './lock.js';

export function processStart(pid: number): string | undefined {
  try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return; }
}
export function livePresence(r: { pid: number; pidStartedAt?: unknown }, isAlive = alive, start = processStart): boolean {
  if (!Number.isSafeInteger(r.pid) || r.pid <= 1 || !isAlive(r.pid)) return false;
  return r.pidStartedAt === undefined || typeof r.pidStartedAt === 'string' && !!r.pidStartedAt.trim() && start(r.pid) === r.pidStartedAt.trim();
}
export function presenceWork(r: Record<string, unknown>, file: string) {
  const lastTool = r.status === 'idle' ? undefined : cleanDoing(r.lastTool) ?? activityLine(r.lastTool);
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : Date.parse(String(r.updatedAt));
  return {
    id: `harness:${createHash('sha256').update(JSON.stringify([file, r.pidStartedAt, r.startedAt])).digest('hex').slice(0, 32)}`,
    kind: r.kind === 'factory' || r.role === 'factory' ? 'factory' as const : 'worker' as const,
    status: r.status === 'idle' ? 'idle' as const : 'working' as const,
    ...(lastTool ? { lastTool } : {}),
    ...(Number.isFinite(updatedAt) && updatedAt >= 0 ? { updatedAt } : {}),
  };
}
export const presenceTitle = (title: unknown) => workLabel(title);
