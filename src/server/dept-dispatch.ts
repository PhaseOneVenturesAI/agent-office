// The lead dispatch (see docs/department-leads.md): the event-driven half of orchestration. A
// department's children — the workers seated for its delegated queue tasks — report transitions
// back to the lead's own session: a blocker (needs_input, with the question), a finished turn
// (done, with the PR when there is one), or a stop (exited). Delivery is a real prompt into the
// lead's worker, never a UI-state broadcast: while the lead's turn runs, one coalesced notice per
// child is held; when the turn ends it is delivered. Notices are at-most-once while the lead is
// observed and never replayed; a lead that is gone drops what it was holding.

import type { Department, QueueTask, WorkerInfo } from '../shared/protocol.js';

/** What the dispatch needs from the floor; narrow on purpose, so a test can fake it. */
export interface DispatchDeps {
  get(id: string): WorkerInfo | undefined;
  /** Prompts the lead's worker; a string means it could not be prompted (not running, stopping...). */
  prompt(id: string, text: string): string | undefined;
  tasks(): QueueTask[];
  departments(): Department[];
}

/** Transitions that wake the lead; everything else is the child's own business. */
const NOTIFY = new Set(['needs_input', 'done', 'exited']);
/** One held notice per child is plenty; this is just a sanity bound on the map itself. */
const MAX_HELD = 64;

export class LeadDispatch {
  /** The last status each worker was seen in, so transitions — not repeats — fire. */
  private last = new Map<string, string>();
  /** Notices held while a lead works: childId -> { parent, text }. Latest only, per child. */
  private held = new Map<string, { parent: string; text: string }>();

  constructor(private deps: DispatchDeps) {}

  /** Forgets a worker that left; a lead that went home drops whatever its children held. */
  onWorkerGone(workerId: string) {
    this.last.delete(workerId);
    this.held.delete(workerId);
    for (const [childId, held] of this.held) if (held.parent === workerId) this.held.delete(childId);
  }

  /** Called with every worker update the floor sees; forwards child transitions to the lead. */
  onWorker(info: WorkerInfo) {
    const previous = this.last.get(info.id);
    this.last.set(info.id, info.status);
    // A transition to idle/done on a lead flushes whatever its children held.
    const dept = this.deps.departments().find((d) => d.lead?.workerId === info.id);
    if (dept && (info.status === 'idle' || info.status === 'done')) this.flush(info.id);
    if (previous === info.status || !NOTIFY.has(info.status)) return;
    const parent = this.parentOf(info.id);
    if (!parent || parent === info.id) return;
    this.deliver(parent, info.id, this.notice(info));
  }

  /** One bounded line the lead can act on. */
  private notice(child: WorkerInfo): string {
    const task = this.deps.tasks().find((t) => t.workerId === child.id);
    const job = task ? `“${task.title}”` : 'its task';
    if (child.status === 'needs_input') return `📣 ${child.name} stopped on ${job}${child.activity ? ` — ${child.activity}` : ''}. It needs a person: say what's needed or answer in its terminal.`;
    if (child.status === 'done') return `📣 ${child.name} ended its turn on ${job}${task?.pr ? ` — PR #${task.pr.number} opened (not yet reviewed)` : ''}. Check the result and say what's next.`;
    return `📣 ${child.name} stopped before finishing ${job}${task?.error ? ` — ${task.error}` : ''}. Decide: requeue it or send it home.`;
  }

  /** Delivers now when the lead can take a prompt; holds one coalesced notice per child otherwise. */
  private deliver(parentId: string, childId: string, text: string) {
    const parent = this.deps.get(parentId);
    if (!parent) return;
    if (parent.status === 'idle' || parent.status === 'done') {
      const err = this.deps.prompt(parentId, text);
      if (!err) {
        this.held.delete(childId);
        return;
      }
      // Could not reach it (stopping, gone): treat as unreachable rather than replaying later.
      if (err !== 'Worker is not running') return;
    }
    if (this.held.size >= MAX_HELD) this.held.delete(this.held.keys().next().value!);
    this.held.set(childId, { parent: parentId, text });
  }

  /** A task ended with no worker transition to carry it (killed, or never started): tell the lead. */
  onTaskFinished(task: QueueTask) {
    if (task.outcome !== 'killed' && task.outcome !== 'failed') return;
    const parent = this.parentOfTask(task);
    if (!parent) return;
    const job = `“${task.title}”`;
    const text =
      task.outcome === 'killed'
        ? `📣 ${task.workerName ?? 'Its worker'} was sent home mid-job on ${job}. Decide: requeue it or drop it.`
        : `📣 Nobody could start ${job}${task.error ? ` — ${task.error}` : ''}. Look into it before requeuing.`;
    this.deliver(parent, task.workerId ?? task.id, text);
  }

  /** Sends everything a lead held while working; whatever fails to deliver is dropped, not replayed. */
  private flush(leadId: string) {
    for (const [childId, held] of this.held) {
      if (held.parent !== leadId) continue;
      this.held.delete(childId);
      const err = this.deps.prompt(leadId, held.text);
      if (err) break; // It stopped mid-flush: the rest are dropped, never replayed.
    }
  }

  /** The lead a task reports to: its delegating parent, else the department's live lead. */
  private parentOfTask(task: QueueTask): string | undefined {
    if (task.parentId && this.deps.get(task.parentId)) return task.parentId;
    if (task.dept) {
      const lead = this.deps.departments().find((d) => d.id === task.dept)?.lead;
      if (lead?.workerId && this.deps.get(lead.workerId)) return lead.workerId;
    }
    return undefined;
  }

  /** The lead worker to report this child to: the delegating parent, else the department's lead. */
  private parentOf(childId: string): string | undefined {
    const task = this.deps.tasks().find((t) => t.workerId === childId && (t.parentId || t.dept));
    return task ? this.parentOfTask(task) : undefined;
  }
}
