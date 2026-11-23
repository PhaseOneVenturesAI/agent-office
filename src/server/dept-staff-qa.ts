// Staff Q&A for a floor (see docs/department-leads.md and staff-qa.ts): a read-only question about
// a department, answered on a SEPARATE one-shot ACP session — never the manager's own provider
// session, never an arbitrary binary from PATH, never on host credentials. The session runs on the
// department's configured engine under an explicitly authorized custodian's own sign-in, from a
// dedicated tool-free home built for the question and deleted after it.

import path from 'node:path';
import { homedir } from 'node:os';
import type { Department } from '../shared/protocol.js';
import { buildQaHome, qaContext, qaLaunch, staffQaAsk, type QaOutcome } from './staff-qa.js';
import { childEnv } from './workers/env.js';
import type { RunAs } from './workers/types.js';

export interface StaffQaFloor {
  dir: string;
  dataDir: string;
  runAs?: RunAs;
  departments: { get(id: string): Department | undefined };
  roleChat: { append(workerId: string, message: import('./role-chat.js').ChatMessage): void };
}

/**
 * Answers one staff question. `custodianId` is the authorized billing custodian's account (from
 * the department's custodian email); without one in an accounts office this fails closed rather
 * than silently spending the host's credentials. `launch` overrides the CLI (tests only).
 */
export async function floorStaffQA(floor: StaffQaFloor, deptId: string, question: string, by: string, custodianId?: string, launchOverride?: { file: string; args: string[] }): Promise<QaOutcome> {
  const dept = floor.departments.get(deptId);
  if (!dept) return { ok: false, why: 'That department is gone' };
  const clean = question.replace(/\r\n?/g, '\n').trim().slice(0, 4000);
  if (!clean) return { ok: false, why: 'Ask a question first' };
  const launch = launchOverride ?? qaLaunch(dept.lead?.provider);
  if (typeof launch === 'string') return { ok: false, why: launch };
  // The environment is account-scoped: the custodian's own Kimi sign-in, never the host's. childEnv
  // already scrubs AGENT_OFFICE_* (no hook URL, no worker token, no office MCP), and session/new
  // declares no MCP servers on top.
  const env = childEnv();
  delete env.KIMI_CODE_HOME;
  delete env.KIMI_API_KEY;
  if (custodianId) {
    if (!floor.runAs) return { ok: false, why: 'This office has no account sign-ins to authorize a custodian.' };
    if (!floor.runAs.ready(custodianId, 'kimi')) return { ok: false, why: `The custodian hasn't authorized a Kimi sign-in here (${floor.runAs.why('kimi')}).` };
    floor.runAs.apply(custodianId, env, [floor.dir], 'kimi');
  }
  const sourceHome = env.KIMI_CODE_HOME ?? path.join(homedir(), '.kimi-code');
  const framing = [
    'You are a read-only Q&A desk inside Agent Office. You are not the department manager and never speak for them.',
    'You have no tools — the session configuration removed every tool — and you cannot be delegated sub-agents. Answer only from the approved context and general knowledge. Never claim to have read files, run commands, assigned work, or made decisions. Keep the answer short, and say plainly when the context does not cover something.',
  ].join('\n\n');
  const qaHome = buildQaHome(sourceHome, framing);
  if (typeof qaHome === 'string') return { ok: false, why: qaHome };
  env.KIMI_CODE_HOME = qaHome.home;
  const context = qaContext({ name: dept.name, brief: dept.brief as { rev: number; text: string }[], lead: dept.lead ? { objective: dept.lead.objective } : undefined, assets: dept.assets });
  const prompt = [context, `Question from ${by}: ${clean}`].join('\n\n');
  let outcome: QaOutcome;
  try {
    outcome = await staffQaAsk({ ...launch, cwd: floor.dir, env, prompt, model: dept.lead?.model, ...(dept.lead?.effort ? { effort: dept.lead.effort } : {}) });
  } finally {
    qaHome.cleanup();
  }
  const at = Date.now();
  floor.roleChat.append(`qa-${deptId}`, { id: `q-${at}`, role: 'user', text: clean, at, by, scope: 'staff' });
  floor.roleChat.append(`qa-${deptId}`, { id: `a-${at}`, role: 'assistant', text: outcome.ok ? outcome.answer : `Unavailable: ${outcome.why}`, at: at + 1, scope: 'staff' });
  return outcome;
}
