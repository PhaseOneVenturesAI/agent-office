import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LeadStatus } from '../../../shared/protocol/hq.js';
import { uuid } from '../../cubbies/local/io.js';
/**
 * A lead the office started headless (a session id, no Claude app chat) never shows in the running-session
 * registry. Once its transcript exists it can be resumed at any time, so it is idle rather than offline.
 */
export function headlessIdle(home: string, project: string, [session, appSession]: unknown[], status: LeadStatus): LeadStatus {
  if (status.status !== 'off' || appSession || !uuid(session)) return status;
  const transcript = path.join(home, '.claude/projects', project.replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`);
  return existsSync(transcript) ? { ...status, status: 'idle' } : status;
}
