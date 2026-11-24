// Staff Q&A for a floor (see docs/department-leads.md and staff-qa.ts): a read-only question about
// a department, answered on a SEPARATE one-shot ACP session — never the manager's own provider
// session, never an arbitrary binary from PATH, never on host credentials. The session runs on the
// department's configured engine under an explicitly authorized custodian's own sign-in, from a
// dedicated tool-free home built for the question and deleted after it.

import path from 'node:path';
import { homedir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Department } from '../shared/protocol.js';
import { buildQaHome, qaContext, qaLaunch, staffQaAsk, type QaOutcome } from './staff-qa.js';
import { codexStaffQaAsk } from './staff-qa-codex.js';
import { qaBaseEnv } from './staff-qa.js';
import type { RunAs } from './workers/types.js';

export interface StaffQaFloor {
  dir: string;
  dataDir: string;
  runAs?: RunAs;
  accountsEnabled?: () => boolean;
  departments: { get(id: string): Department | undefined };
  roleChat: { append(workerId: string, message: import('./role-chat.js').ChatMessage): void };
}

/**
 * Answers one staff question. `custodianId` is the authorized billing custodian's account (from
 * the department's custodian email); without one in an accounts office this fails closed rather
 * enforces it; without accounts the office's own login is the custodian.
 */
export async function floorStaffQA(floor: StaffQaFloor, deptId: string, question: string, by: string, custodianId?: string, launchOverride?: { file: string; args: string[] }): Promise<QaOutcome> {
  if (floor.accountsEnabled?.() !== false && !custodianId) return { ok: false, why: 'An authorized billing custodian is required for staff Q&A.' };
  const dept = floor.departments.get(deptId);
  if (!dept) return { ok: false, why: 'That department is gone' };
  const clean = question.replace(/\r\n?/g, '\n').trim().slice(0, 4000);
  if (!clean) return { ok: false, why: 'Ask a question first' };
  const provider = dept.policy?.provider ?? dept.lead?.provider;
  const model = dept.policy?.provider ? dept.policy.model : dept.lead?.model;
  const effort = dept.policy?.provider ? dept.policy.effort : dept.lead?.effort;
  const launch = launchOverride ?? qaLaunch(provider, model);
  if (typeof launch === 'string') return { ok: false, why: launch };
  // Start with runtime basics only; the selected account adds only its provider credentials.
  if (provider !== 'kimi' && provider !== 'codex') return { ok: false, why: 'No verified tool-free Q&A adapter for this provider.' };
  if (provider === 'codex' && !custodianId) return { ok: false, why: 'Codex Q&A requires an explicitly authorized personal subscription custodian.' };
  const env = qaBaseEnv();
  delete env.KIMI_CODE_HOME;
  delete env.KIMI_API_KEY;
  if (custodianId) {
    if (!floor.runAs) return { ok: false, why: 'This office has no account sign-ins to authorize a custodian.' };
    if (!floor.runAs.ready(custodianId, provider)) return { ok: false, why: `The custodian hasn't authorized a ${provider} sign-in here (${floor.runAs.why(provider)}).` };
    floor.runAs.apply(custodianId, env, [], provider);
  }
  const context = qaContext({ name: dept.name, brief: dept.brief as { rev: number; text: string }[], lead: dept.lead ? { objective: dept.lead.objective } : undefined, assets: dept.assets });
  const prompt = ['You are the read-only department Q&A desk. Answer from the approved context; do not assign work or claim to be the manager.', context, `Question from ${by}: ${clean}`].join('\n\n');
  if (provider === 'codex') {
    const outcome = await codexStaffQaAsk({ file: launch.file, env, prompt, model, effort });
    recordAnswer(floor, deptId, clean, by, outcome);
    return outcome;
  }
  const sourceHome = env.KIMI_CODE_HOME ?? path.join(homedir(), '.kimi-code');
  const framing = [
    'You are a read-only Q&A desk inside Agent Office. You are not the department manager and never speak for them.',
    'You have no tools — the session configuration removed every tool — and you cannot be delegated sub-agents. Answer only from the approved context and general knowledge. Never claim to have read files, run commands, assigned work, or made decisions. Keep the answer short, and say plainly when the context does not cover something.',
  ].join('\n\n');
  const qaHome = buildQaHome(sourceHome, framing);
  if (typeof qaHome === 'string') return { ok: false, why: qaHome };
  env.KIMI_CODE_HOME = qaHome.home;
  env.HOME = qaHome.home;
  // The session works in an EMPTY scratch directory, never the project: the CLI auto-loads
  // AGENTS.md and project files from the cwd, which would leak context the approved snapshot
  // didn't include.
  let scratch: string | undefined;
  let outcome: QaOutcome;
  try {
    scratch = mkdtempSync(path.join(tmpdir(), 'agent-office-staff-qa-cwd-'));
    outcome = await staffQaAsk({ ...launch, cwd: scratch, env, prompt, model, ...(effort ? { effort } : {}) });
  } catch {
    outcome = { ok: false, why: 'The isolated Q&A session could not be prepared.' };
  } finally {
    qaHome.cleanup();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  recordAnswer(floor, deptId, clean, by, outcome);
  return outcome;
}

function recordAnswer(floor: StaffQaFloor, deptId: string, clean: string, by: string, outcome: QaOutcome) {
  const at = Date.now();
  floor.roleChat.append(`qa-${deptId}`, { id: `q-${at}`, role: 'user', text: clean, at, by, scope: 'staff' });
  floor.roleChat.append(`qa-${deptId}`, { id: `a-${at}`, role: 'assistant', text: outcome.ok ? outcome.answer : `Unavailable: ${outcome.why}`, at: at + 1, scope: 'staff' });
}
