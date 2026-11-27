import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MacConfig } from '../hq/local/config.js';
import { LeadError, NativeLead } from '../cubbies/local/lead.js';
import type { LocalTarget } from './targets.js';
import { deliveredText, type LeadSend } from '../../shared/protocol/lead-talk.js';

/** launchd's PATH omits ~/.local/bin, where the native installer puts claude. */
export const claudeExecutable = (home: string) => { const local = path.join(home, '.local/bin/claude'); return existsSync(local) ? local : 'claude'; };
export async function sendHeadless(config: MacConfig, target: LocalTarget, frame: LeadSend, signal: AbortSignal, executable = claudeExecutable(config.home)) {
  if (!target.sessionId) throw new LeadError('Open this lead in the Claude app once so it can be reached');
  if (!target.project) throw new LeadError('Cofounder has no registered project folder for headless resume');
  const lead = new NativeLead({
    ownerKey: '', floor: '', project: target.project, roots: [target.project], branches: new Map(),
    state: config.state, computerId: config.computerId, provider: 'claude', session: target.sessionId,
    executable, claudeHome: path.join(config.home, '.claude'), fresh: false,
  }, async () => ({ complete: true, processes: [] }));
  try { return await lead.send(deliveredText(frame), signal); }
  finally { await lead.stop(); }
}
