import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { HandoffBrief, WorkerHandoff } from '../../shared/protocol.js';
import type { Worker, WorkerContext } from './types.js';

const idle = (w: Worker) => !w.bootBlocked && !w.info.lost && !!(w.pty || w.dsh) && ['idle', 'done'].includes(w.info.status);
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
}

/** Bound and validate disk state; unknown/corrupt versions cannot become executable handoffs. */
export function savedHandoff(v: unknown): WorkerHandoff | undefined {
  if (!v || typeof v !== 'object') return;
  const h = v as WorkerHandoff;
  const keys = ['id', 'from', 'to', 'fromName', 'toName', 'fromPath', 'toPath', 'fromBranch', 'toBranch', 'brief', 'evidence', 'next', 'by', 'prompt'] as const;
  if (!keys.every((k) => typeof h[k] === 'string' && h[k].length > 0 && h[k].length <= 20000) || !Number.isFinite(h.at) || !['pending', 'acknowledged', 'delivery-failed'].includes(h.state)) return;
  return h;
}
