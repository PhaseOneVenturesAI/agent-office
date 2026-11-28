import path from 'node:path';
import type { MacConfig } from '../hq/local/config.js';
import { NativeLead } from '../cubbies/local/lead.js';
import { claudeExecutable } from './headless.js';
import { privateRecord } from './project-registry.js';
export async function startProjectLead(config: MacConfig, project: string, session: string, prompt: string, signal: AbortSignal) {
  const state = path.join(config.state, 'projects', session);
  privateRecord(path.join(state, 'session.json'), { session, authorizedNew: true });
  const lead = new NativeLead({ ownerKey: '', floor: '', project, roots: [project], branches: new Map(), state,
    computerId: config.computerId, provider: 'claude', session, executable: claudeExecutable(config.home), claudeHome: path.join(config.home, '.claude'), fresh: true });
  try { return await lead.send(prompt, signal); } finally { await lead.stop(); }
}
