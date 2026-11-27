import { opendirSync } from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../../cubbies/local/io.js';
import { alive } from '../../cubbies/local/lock.js';
import type { LeadStatus } from '../../../shared/protocol/hq.js';
export interface SessionRecord {
  ids: string[]; sessionId?: string; pid: number; running: boolean;
  status: 'busy' | 'idle'; updatedAt: number; messagingSocketPath?: string;
}
/** Shared bounded inventory. Socket metadata is local-only and never enters a snapshot. */
export function sessionRecords(home: string, isAlive = alive, now = Date.now()) {
  const rows: SessionRecord[] = [];
  let dir, unreadable = false;
  try {
    dir = opendirSync(path.join(home, '.claude/sessions'));
    let file, count = 0;
    while ((file = dir.readSync())) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      if (++count > 256) { unreadable = true; break; }
      try {
        const r = jsonFile(path.join(home, '.claude/sessions', file.name), 16 * 1024);
        if (!r || !['busy', 'idle'].includes(r.status)) { unreadable = true; continue; }
        const ids = [r.sessionId, r.bridgeSessionId, r.hostSessionId].filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256);
        const at = typeof r.updatedAt === 'number' ? r.updatedAt : Date.parse(r.updatedAt);
        if (!ids.length || !Number.isFinite(at) || at < 0 || at > now + 120_000) { unreadable = true; continue; }
        if (!Number.isSafeInteger(r.pid) || r.pid <= 1) { unreadable = true; continue; }
        rows.push({ ids, pid: r.pid, running: isAlive(r.pid), status: r.status, updatedAt: at,
          sessionId: typeof r.sessionId === 'string' ? r.sessionId : undefined,
          messagingSocketPath: typeof r.messagingSocketPath === 'string' ? r.messagingSocketPath : undefined });
      } catch { unreadable = true; }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') unreadable = true; }
  finally { dir?.closeSync(); }
  return { rows, unreadable };
}
/** Session identities are used locally, then discarded. No raw registry object enters a frame. */
export function sessionStatuses(home: string, isAlive = alive, now = Date.now()) {
  const { rows, unreadable } = sessionRecords(home, isAlive, now);
  return (ids: unknown[]): LeadStatus => {
    const r = rows.filter(r => r.ids.some(id => ids.includes(id))).sort((a,b) => b.updatedAt - a.updatedAt)[0];
    return r ? { status: r.running ? r.status : 'off', updatedAt: r.updatedAt } : { status: unreadable ? 'unknown' : 'off', updatedAt: now };
  };
}
