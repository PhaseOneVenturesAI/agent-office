import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../cubbies/local/io.js';
import { requestsDir } from './project-registry.js';
/** Only request identity and bounded status leave the Mac, never harness paths or prose. */
export function requestStatuses(home: string): { project: string; status: string }[] {
  const dir = requestsDir(home); if (!existsSync(dir)) return [];
  const latest = new Map<string, { at: string; status: string }>();
  for (const name of readdirSync(dir).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).slice(-256)) {
    try {
      const request = jsonFile(path.join(dir, name), 4096);
      if (request.schema !== 1 || request.source !== 'office-link' || typeof request.project !== 'string' || typeof request.createdAt !== 'string') continue;
      let status = 'Waiting for harness registration';
      if (existsSync(path.join(dir, 'done', name))) {
        const done = jsonFile(path.join(dir, 'done', name), 4096);
        const value = typeof done.status === 'string' ? done.status : done.ok === true ? 'registered' : done.ok === false ? 'failed' : 'processed';
        status = `Harness: ${value.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 60)}`;
      }
      if (!latest.has(request.project) || latest.get(request.project)!.at < request.createdAt) latest.set(request.project, { at: request.createdAt, status });
    } catch { /* Incomplete or invalid receipts do not gate the project. */ }
  }
  return [...latest].map(([project, row]) => ({ project, status: row.status }));
}
