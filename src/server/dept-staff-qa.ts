// Staff Q&A for a floor (see docs/department-leads.md): a read-only question about a department,
// answered on a SEPARATE one-shot ACP session — never the manager's own provider session. The
// office auto-rejects every tool permission the session requests; the prompt carries only an
// approved context snapshot (see Departments.contextNote). The exchange is recorded under the
// staff scope.

import type { Department } from '../shared/protocol.js';
import { acpCommand, qaContext, staffQaAsk, type QaOutcome } from './staff-qa.js';
import { harnessRoot } from './harness.js';

export interface StaffQaFloor {
  dir: string;
  dataDir: string;
  departments: { get(id: string): Department | undefined };
  roleChat: { append(workerId: string, message: import('./role-chat.js').ChatMessage): void };
}

export async function floorStaffQA(floor: StaffQaFloor, deptId: string, question: string, by: string): Promise<QaOutcome> {
  const dept = floor.departments.get(deptId);
  if (!dept) return { ok: false, why: 'That department is gone' };
  const clean = question.replace(/\r\n?/g, '\n').trim().slice(0, 4000);
  if (!clean) return { ok: false, why: 'Ask a question first' };
  const command = acpCommand();
  if (!command) {
    return { ok: false, why: 'Read-only staff Q&A needs a Kimi or DeepSeek Harness CLI on this office machine. It never uses the manager’s own session, so it is unavailable here rather than pretending.' };
  }
  const context = qaContext({ name: dept.name, brief: dept.brief as { rev: number; text: string }[], lead: dept.lead ? { objective: dept.lead.objective } : undefined, assets: dept.assets });
  const prompt = [
    `You are the read-only Q&A desk for the ${dept.name} department. You are not the manager and never speak for them.`,
    'You have no tools: the office denies every tool request, so answer only from the approved context below and general knowledge. Never claim to have read files, run commands, assigned work, or made decisions. Keep the answer short, and say plainly when the context does not cover something.',
    context,
    `Question from ${by}: ${clean}`,
  ].join('\n\n');
  const outcome = await staffQaAsk({ ...command, cwd: floor.dir, prompt });
  const at = Date.now();
  floor.roleChat.append(`qa-${deptId}`, { id: `q-${at}`, role: 'user', text: clean, at, by, scope: 'staff' });
  floor.roleChat.append(`qa-${deptId}`, { id: `a-${at}`, role: 'assistant', text: outcome.ok ? outcome.answer : `Unavailable: ${outcome.why}`, at: at + 1, scope: 'staff' });
  return outcome;
}
