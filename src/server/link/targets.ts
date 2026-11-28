import type { TalkTarget } from '../../shared/protocol/lead-talk.js';
import type { MacConfig } from '../hq/local/config.js';
import { macEntries } from '../hq/local/snapshot.js';
import { sessionRecords } from '../hq/local/sessions.js';
import { canonical, jsonFile, uuid } from '../cubbies/local/io.js';
import { LeadError } from '../cubbies/local/lead.js';

export interface LocalTarget { key: string; project?: string; sessionId?: string; appSession?: string }
const appId = (id: unknown): string | undefined => typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : undefined;
function target(ids: unknown[], project?: string): LocalTarget {
  const sessionId = uuid(ids[0]) ? ids[0] : undefined, appSession = appId(ids[1]);
  if (!sessionId && !appSession) throw new LeadError('This lead is not registered on this Mac');
  return { key: sessionId ?? appSession!, project, sessionId, appSession };
}
/** Exactly the snapshot's filtering, cleaning, department ordering and project cap. */
export function resolveTarget(config: MacConfig, selected: TalkTarget): LocalTarget {
  const registry = jsonFile(config.projectsFile, 256 * 1024);
  if ('cofounder' in selected) {
    const c = registry?.cofounder;
    if (!c || (!uuid(c.leadSessionId) && !appId(c.leadAppSession))) throw new LeadError("Cofounder isn't registered on this Mac");
    return target([c.leadSessionId, c.leadAppSession]);
  }
  const matches = macEntries(registry).filter(e => e.project.name === selected.project);
  if (matches.length !== 1) throw new LeadError('This project is not available on this Mac');
  const entry = matches[0];
  const ids = selected.department === undefined ? entry.sessions : entry.departments[selected.department]?.ids;
  if (!ids) throw new LeadError('This department lead is not registered on this Mac');
  return target(ids, canonical(entry.path));
}
export function liveSession(home: string, target: LocalTarget, isAlive?: (pid: number) => boolean) {
  const inventory = sessionRecords(home, isAlive);
  const ids = [target.sessionId, target.appSession].filter(Boolean);
  const record = inventory.rows.filter(r => r.ids.some(id => ids.includes(id)) && r.running)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (record) return record;
  // A failed inventory read cannot authorize a second session.
  if (inventory.unreadable) throw new LeadError('Cannot read the local lead registry; check the Claude app');
  return undefined;
}
