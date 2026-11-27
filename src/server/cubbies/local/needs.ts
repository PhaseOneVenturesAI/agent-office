import path from 'node:path';
import os from 'node:os';
import { canonical, jsonFile } from './io.js';
import { cleanNeeds, type HQNeeds } from '../../../shared/protocol/hq.js';

export interface NeedsRead { entries: { path: string; needs: HQNeeds }[]; error?: true }
/** No source files are followed: only this bounded, read-only health-check publication. */
export function readNeeds(file = path.join(os.homedir(), 'Library/Application Support/AgentHarness/needs.json'), now = Date.now()): NeedsRead {
  try {
    const raw = jsonFile(file, 64 * 1024);
    if (raw?.schema !== 1 || typeof raw.generatedAt !== 'string' || !Number.isFinite(Date.parse(raw.generatedAt)) ||
      typeof raw.staleAfterHours !== 'number' || !Number.isFinite(raw.staleAfterHours) || raw.staleAfterHours <= 0 ||
      !raw.projects || typeof raw.projects !== 'object' || Array.isArray(raw.projects)) throw Error('Invalid needs record');
    const entries: NeedsRead['entries'] = [];
    for (const value of Object.values(raw.projects) as any[]) {
      const needs = cleanNeeds({ ...value, at: raw.generatedAt, stale: now - Date.parse(raw.generatedAt) > raw.staleAfterHours * 3600_000 });
      if (!needs || typeof value.path !== 'string') throw Error('Invalid project needs');
      entries.push({ path: value.path, needs });
    }
    return { entries };
  } catch (error) { return { entries: [], ...((error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { error: true as const }) }; }
}
/** Same canonical worktree-or-exact-path match as the local lead configuration. */
export function needsFor(read: NeedsRead, project: string, roots: string[] = []): HQNeeds | undefined {
  const registered = canonical(project);
  const matches = read.entries.filter(e => {
    const p = canonical(e.path);
    return e.path === project || !!p && (p === registered || roots.includes(p));
  });
  return matches.length === 1 ? matches[0].needs : undefined;
}
