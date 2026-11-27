import { opendirSync } from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../../cubbies/local/io.js';
import { alive } from '../../cubbies/local/lock.js';
import type { LeadStatus } from '../../../shared/protocol/hq.js';
/** Session identities are used locally, then discarded. No raw registry object enters a frame. */
export function sessionStatuses(home: string, isAlive = alive, now = Date.now()) {
  const rows: { ids: string[]; status: LeadStatus }[] = [];
  let dir;
  try {
    dir = opendirSync(path.join(home, '.claude/sessions'));
    let file, count = 0;
    while ((file = dir.readSync()) && count < 256) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      count++;
      try {
        const r = jsonFile(path.join(home, '.claude/sessions', file.name), 16 * 1024);
        if (!r || !['busy', 'idle'].includes(r.status)) continue;
        const ids = [r.sessionId, r.bridgeSessionId].filter((v): v is string => typeof v === 'string' && v.length <= 256);
        const at = typeof r.updatedAt === 'number' ? r.updatedAt : Date.parse(r.updatedAt);
        if (!ids.length || !Number.isFinite(at) || at < 0 || at > now + 120_000) continue;
        const running = Number.isSafeInteger(r.pid) && r.pid > 1 && isAlive(r.pid);
        rows.push({ ids, status: { status: running ? r.status : 'off', updatedAt: at } });
      } catch { /* Malformed, oversized or unreadable records cannot claim a live lead. */ }
    }
  } catch { /* Missing registry means offline, never inferred activity. */ }
  finally { dir?.closeSync(); }
  return (ids: unknown[]): LeadStatus => rows.filter(r => r.ids.some(id => ids.includes(id)))
    .sort((a,b) => b.status.updatedAt - a.status.updatedAt)[0]?.status ?? { status: 'off', updatedAt: now };
}
