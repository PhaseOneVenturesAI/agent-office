import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { HandoffBrief, WorkerHandoff, WorkerInfo } from '../../shared/protocol.js';
import type { Worker, WorkerContext } from './types.js';

const idle = (w: Worker) => !w.stopping && !w.bootBlocked && !w.info.lost && !!(w.pty || w.dsh) && ['idle', 'done'].includes(w.info.status);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max ? v.trim() : '';

/** Task responsibility only: provider credential ownership, sessions and worktrees never move. */
export class WorkerHandoffs {
  constructor(private ctx: WorkerContext, private send: (id: string, text: string, by: string) => string | undefined,
    private save: () => boolean,
    private branch: (cwd: string) => string = (cwd) => execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(), private canonical: (cwd: string) => string = realpathSync) {}

  prepare(from: string, to: string, value: HandoffBrief, by: string): WorkerHandoff | string {
    const source = this.ctx.workers.get(from), target = this.ctx.workers.get(to);
    if (!source || !target || source === target || source.info.kind !== 'agent' || target.info.kind !== 'agent') return 'Choose two existing agents on this floor.';
    if (source.info.handoff?.state === 'pending' || target.info.handoff?.state === 'pending') return 'Review the pending handoff first; it has not been delivered.';
    const brief = text(value?.brief, 6000), evidence = text(value?.evidence, 4000), next = text(value?.next, 3000);
    if (!brief || !evidence || !next) return 'Include the scoped brief, verification evidence (or explicitly unverified), and next step.';
    let fromBranch: string, toBranch: string;
    const fromPath = this.ctx.cwd(source.info), toPath = this.ctx.cwd(target.info);
    try {
      if (this.canonical(fromPath) === this.canonical(toPath)) return 'Choose workers in separate physical worktrees before handing off implementation.';
      fromBranch = this.branch(fromPath); toBranch = this.branch(toPath);
    } catch { return 'Both workspaces must have an inspectable Git branch before a handoff.'; }
    const prompt = `Human-acknowledged handoff from ${source.info.name} to ${target.info.name}.\nSource workspace: ${fromPath}\nSource branch: ${fromBranch}\nYour existing workspace: ${toPath}\nYour branch: ${toBranch}\n\nScoped brief:\n${brief}\n\nEvidence (human supplied; verify before relying on it):\n${evidence}\n\nNext step:\n${next}\n\nWork in your existing workspace. Preserve source work and existing owners. Do not spawn a duplicate agent, silently switch providers/models, or treat this handoff as approval to publish, deploy, spend, or bypass tool approvals.`;
    const handoff: WorkerHandoff = { id: randomUUID(), from, to, fromName: source.info.name, toName: target.info.name, fromPath, toPath, fromBranch, toBranch, brief, evidence, next, by, at: Date.now(), state: 'pending', prompt };
    const old = source.info.handoff;
    source.info.handoff = handoff;
    if (!this.save()) { source.info.handoff = old; return 'Could not save the handoff; nothing was sent.'; }
    this.ctx.emit(source);
    return handoff;
  }

  acknowledge(from: string, id: string, by: string): string | undefined {
    const source = this.ctx.workers.get(from), handoff = source?.info.handoff;
    if (!source || !handoff || handoff.id !== id || handoff.state !== 'pending') return 'That handoff is no longer pending; nothing was sent.';
    const target = this.ctx.workers.get(handoff.to);
    if (!target || !idle(source) || !idle(target)) return 'Both existing agents must be idle or done. Resolve permission prompts in their terminals first.';
    if (target.info.handoff?.state === 'pending') return 'The recipient already has a pending handoff.';
    try {
      if (this.canonical(handoff.fromPath) === this.canonical(handoff.toPath)) return 'The agents now share one physical worktree; nothing was sent.';
      if (this.ctx.cwd(source.info) !== handoff.fromPath || this.ctx.cwd(target.info) !== handoff.toPath || this.branch(handoff.fromPath) !== handoff.fromBranch || this.branch(handoff.toPath) !== handoff.toBranch) return 'A workspace or branch changed. Prepare a new handoff after reviewing the current context.';
    } catch { return 'Could not recheck the current branches; nothing was sent.'; }
    const accepted: WorkerHandoff = { ...handoff, state: 'acknowledged', acknowledgedBy: by, acknowledgedAt: Date.now() };
    const previous = target.info.handoff;
    source.info.handoff = target.info.handoff = accepted;
    // Commit the receipt before delivery. After a crash its outcome may be uncertain: never replay.
    if (!this.save()) { source.info.handoff = handoff; target.info.handoff = previous; return 'Could not save acknowledgment; nothing was sent.'; }
    const previousStatus = target.info.status;
    this.ctx.setStatus(target, 'working');
    const error = this.send(target.info.id, accepted.prompt, by);
    if (error) { accepted.state = 'delivery-failed'; this.ctx.setStatus(target, previousStatus); this.save(); }
    this.ctx.emit(source); this.ctx.emit(target);
    return error;
  }

  cancel(from: string, id: string): string | undefined {
    const source = this.ctx.workers.get(from), handoff = source?.info.handoff;
    if (!source || !handoff || handoff.id !== id || handoff.state !== 'pending') return 'That handoff is no longer pending.';
    delete source.info.handoff;
    if (!this.save()) { source.info.handoff = handoff; return 'Could not save cancellation.'; }
    this.ctx.emit(source);
  }

  /**
   * The swap reservation (see docs/department-leads.md): set on the source before a replacement
   * spawns, so a second swap, a prompt or another handoff sees it; cleared on resolution.
   */
  reserve(id: string, swap: NonNullable<WorkerInfo['swap']>): string | undefined {
    const w = this.ctx.workers.get(id);
    if (!w) return 'No such worker';
    if (w.info.swap) return `Already being swapped to ${w.info.swap.engine}`;
    w.info.swap = swap;
    this.save();
    this.ctx.emit(w);
    return undefined;
  }

  /** Clears a swap reservation (rolled back, cancelled, or landed and relinked). */
  clearSwap(id: string): void {
    const w = this.ctx.workers.get(id);
    if (!w?.info.swap) return;
    delete w.info.swap;
    this.save();
    this.ctx.emit(w);
  }

  /** Records which worker the staged swap seated as the replacement, so removal can clean up. */
  tagReplacement(id: string, replacementId: string): void {
    const w = this.ctx.workers.get(id);
    if (!w?.info.swap) return;
    w.info.swap = { ...w.info.swap, replacementId };
    this.save();
    this.ctx.emit(w);
  }

  /** A swap replacement died before the handoff landed: free its source to try again. */
  freeReplacement(deadId: string): void {
    for (const w of this.ctx.workers.values()) {
      if (w.info.swap?.replacementId !== deadId) continue;
      const engine = w.info.swap.engine;
      delete w.info.swap;
      this.save();
      this.ctx.emit(w);
      this.ctx.events.toast(`🔁 The replacement for ${w.info.name}'s swap to ${engine} went home before the handoff landed — the swap is off; stage it again when ready.`, 'warn');
    }
  }
}

/** Bound and validate disk state; unknown/corrupt versions cannot become executable handoffs. */
export function savedHandoff(v: unknown): WorkerHandoff | undefined {
  if (!v || typeof v !== 'object') return;
  const h = v as WorkerHandoff;
  const keys = ['id', 'from', 'to', 'fromName', 'toName', 'fromPath', 'toPath', 'fromBranch', 'toBranch', 'brief', 'evidence', 'next', 'by', 'prompt'] as const;
  if (!keys.every((k) => typeof h[k] === 'string' && h[k].length > 0 && h[k].length <= 20000) || !Number.isFinite(h.at) || !['pending', 'acknowledged', 'delivery-failed'].includes(h.state)) return;
  return h;
}

const clipSwap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The handoff brief an engine swap prepares (see docs/department-leads.md): the replacement takes
 * over the task on a new engine; the source keeps its session, transcript and branch. The person
 * reviews the exact prompt and acknowledges once — evidence is explicitly unverified until they
 * (or the replacement) checks the source branch and its CI.
 */
export function swapBrief(source: WorkerInfo, engine: string, note?: string, role?: { role: string; name: string; objective?: string; lastReply?: string }): HandoffBrief {
  if (role) {
    const brief = [
      note?.trim() || `Take over as ${role.name}, the ${role.role}, continuing on ${engine}.`,
      role.objective ? `Current objective (maintained — this, not a task label, is the assignment):\n${role.objective}` : 'No objective is active: ask the office what this character is driving before doing anything.',
      role.lastReply ? `Their last reviewed reply (context, not a decision to repeat blindly):\n${role.lastReply.slice(0, 600)}` : '',
      'The source keeps its own session, transcript and branch: read the durable conversation record and the branch before acting. You become the character on acknowledgment — the routing identity moves to you.',
    ].filter(Boolean).join('\n');
    return { brief, evidence: 'Explicitly unverified: a swap moves the seat, not the proof. Check the durable record and the source branch before building on them.', next: role.objective ? `Continue the objective: ${role.objective.slice(0, 200)}` : 'Ask the office what this character was driving, then continue it.' };
  }
  const task = (source.task ? `${source.task.name}: ${source.task.summary}` : source.prompt)?.replace(/\s+/g, ' ').trim();
  const branch = source.worktree?.made ?? source.worktree?.branch;
  const brief = [
    note?.trim() || (task ? `Take over “${clipSwap(task, 300)}”, continuing it on ${engine}.` : `Take over this worker's current job on ${engine}.`),
    branch ? `Source branch: ${branch} — left exactly as it is. Preserve or merge from it; never rebase over other people's work.` : 'The source has no branch of its own: pick the work up from its last pull request or its terminal history.',
    'The source worker is not stopped by the swap and keeps its own session and transcript: do not spawn a duplicate of it or repeat its finished steps.',
  ].join('\n');
  const evidence = 'Explicitly unverified: an engine swap moves the task, not the proof. Check the source branch and its CI before building on it.';
  const next = task ? `Continue: ${clipSwap(task, 240)}` : 'Ask the office what the worker was on, then continue it.';
  return { brief, evidence, next };
}

/**
 * Why this worker can't be swapped right now — every refusal that must fire BEFORE a replacement
 * spawns: not an agent, already reserved, a handoff still pending review, or a turn still running.
 */
export function swapGuard(source: WorkerInfo): string | undefined {
  if (source.kind !== 'agent') return 'Only an agent worker can change engines';
  if (source.swap) return `Already being swapped to ${source.swap.engine}`;
  if (source.handoff?.state === 'pending') return 'Review the pending handoff first; it has not been delivered.';
  if (!['idle', 'done'].includes(source.status)) return `${source.name} is ${source.status} — wait until its turn ends before swapping its engine`;
}
