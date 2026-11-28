import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../cubbies/local/io.js';
import { requestsDir } from './project-registry.js';
/** The harness moves each request, unchanged, into `done/` or `rejected/` once it has handled it. */
const FOLDERS = [['', 'Waiting for harness registration'], ['done', 'Registered on this Mac'], ['rejected', 'The harness refused to register it']] as const;
/** Only request identity and bounded status leave the Mac, never harness paths or prose. */
export function requestStatuses(home: string): { project: string; status: string }[] {
  const root = requestsDir(home); if (!existsSync(root)) return [];
  const latest = new Map<string, { at: string; status: string }>();
  for (const [folder, status] of FOLDERS) {
    const dir = path.join(root, folder);
    let names: string[];
    try { names = readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).slice(-256); } catch { continue; }
    for (const name of names) {
      try {
        const request = jsonFile(path.join(dir, name), 4096);
        if (request.schema !== 1 || request.source !== 'office-link' || typeof request.project !== 'string' || typeof request.createdAt !== 'string') continue;
        const prior = latest.get(request.project);
        if (!prior || prior.at <= request.createdAt) latest.set(request.project, { at: request.createdAt, status });
      } catch { /* Incomplete or invalid receipts do not gate the project. */ }
    }
  }
  return [...latest].map(([project, row]) => ({ project, status: row.status }));
}
