// Staff Q&A (see docs/department-leads.md): a read-only question about a department, answered on a
// SEPARATE one-shot ACP session — never the manager's own provider session. A staff question can
// therefore never touch the manager's memory, choices, or authority: the office auto-rejects every
// tool permission the session requests, the prompt carries only an approved context snapshot (the
// current brief, the active objective, the current brand-reference labels), and the exchange is
// recorded under the staff scope. When no ACP CLI is available the answer is a truthful
// "unavailable" — staff content is never passed into a manager session to make do.

import { DshSession } from './dsh.js';
import { childEnv } from './workers/env.js';
import { resolveCommand } from './workers/process.js';

export type QaOutcome = { ok: true; answer: string } | { ok: false; why: string };

/** An ACP-capable CLI for one-shot read-only sessions, in preference order. */
export function acpCommand(): { file: string; args: string[] } | undefined {
  const kimi = resolveCommand('kimi');
  if (kimi) return { file: kimi, args: ['acp'] };
  const dsh = resolveCommand('dsh');
  if (dsh) return { file: dsh, args: ['--profile', 'acp'] };
  return undefined;
}

/**
 * Runs one read-only question to a throwaway ACP session. Every permission request is rejected by
 * the office (Esc), so the agent has no tools: it can only answer from the prompt it was given.
 * Resolves with the answer text, or a truthful why.
 */
export function staffQaAsk(opts: { file: string; args: string[]; cwd: string; prompt: string; timeoutMs?: number }): Promise<QaOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let answered = false;
    let session: DshSession;
    const finish = (outcome: QaOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void session.close().then(() => resolve(outcome));
    };
    session = new DshSession(
      { file: opts.file, args: opts.args, cwd: opts.cwd, env: childEnv(), firstPrompt: opts.prompt },
      {
        output: () => {},
        status: (status) => {
          // Read-only: every tool request is rejected outright; a question without a reject choice
          // is cancelled. The session can only answer in text.
          if (status === 'needs_input') session.writeInput('\x1b');
          if (status === 'done' && !answered) finish({ ok: false, why: 'The read-only session ended without an answer.' });
        },
        assistant: (text) => {
          answered = true;
          const answer = text.trim();
          finish(answer ? { ok: true, answer } : { ok: false, why: 'The read-only session answered with nothing.' });
        },
        action: () => {},
        usage: () => {},
        session: () => {},
        prompted: () => {},
        exit: (code, error) => finish({ ok: false, why: error ?? `The read-only session exited (${code ?? 'killed'}) before answering.` }),
      },
    );
    const timer = setTimeout(() => finish({ ok: false, why: 'The read-only session timed out.' }), opts.timeoutMs ?? 120_000);
    session.start();
  });
}

/** The approved context snapshot a staff answer may draw on: current brief, objective, references. */
export function qaContext(dept: { name: string; brief: { rev: number; text: string }[]; lead?: { objective?: { text: string } }; assets: { label: string; status: string }[] }): string {
  const brief = dept.brief[0];
  const assets = dept.assets.filter((a) => a.status === 'current').slice(0, 8);
  return [
    `Department: ${dept.name}.`,
    brief ? `Current brief (rev ${brief.rev}):\n${brief.text}` : 'No brief is written yet.',
    dept.lead?.objective ? `Active objective (for context only — you may not act on it):\n${dept.lead.objective.text}` : '',
    assets.length ? `Current approved references (labels only): ${assets.map((a) => a.label).join(', ')}.` : '',
  ].filter(Boolean).join('\n\n');
}
