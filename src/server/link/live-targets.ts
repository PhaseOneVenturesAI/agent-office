import type { TalkTarget } from '../../shared/protocol/lead-talk.js';
import type { MacConfig } from '../hq/local/config.js';
import { macEntries } from '../hq/local/snapshot.js';
import { sessionRecords } from '../hq/local/sessions.js';
import { jsonFile } from '../cubbies/local/io.js';
import { resolveTarget } from './targets.js';
import type { Activity } from './activity.js';

/** Registry-only matching; cwd and the hook's project label never authorize a lead. */
export function activityTarget(config: MacConfig, event: Activity, isAlive?: (pid: number) => boolean): TalkTarget | undefined {
  try {
    const entries = macEntries(jsonFile(config.projectsFile, 256 * 1024));
    const targets: TalkTarget[] = [{ cofounder: true }, ...entries.flatMap(e => [
      ...(e.project.hasMainLead ? [{ project: e.project.name }] : []),
      ...e.departments.map((_, department) => ({ project: e.project.name, department })),
    ])];
    const records = sessionRecords(config.home, isAlive).rows;
    const matches = targets.filter(t => {
      let local;
      try { local = resolveTarget(config, t); } catch { return false; }
      const ids = [local.sessionId, local.appSession].filter(Boolean);
      // Both supplied event identities must belong to that same registered session.
      return records.some(r => r.running && r.ids.some(id => ids.includes(id)) && r.ids.includes(event.sessionId) &&
        (!event.appSession || r.ids.includes(event.appSession)));
    });
    return matches.length === 1 ? matches[0] : undefined;
  } catch { return; }
}
