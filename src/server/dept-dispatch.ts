// The orchestration dispatch (see docs/department-leads.md): the event-driven half of the
// CEO → manager → worker chain. A department's children — the workers seated for its delegated
// queue tasks — report transitions back to the manager's own session: a blocker (needs_input, with
// the question), a finished turn (done, with the PR when there is one), or a stop (exited). A
// manager with an active CEO objective rolls the same line up to the CEO. Delivery is a real
// prompt into the parent's session, never a UI-state broadcast: while a parent's turn runs, one
// coalesced notice per child is held; when the turn ends it is delivered — each item re-checking
// that the parent can still take a prompt, so a busy terminal is never injected mid-flush. Notices
// are at-most-once while the parent is observed and never replayed; a parent that is gone drops
// what it was holding.

import { readFileSync, writeFileSync } from 'node:fs';
import type { Department, QueueTask, WorkerInfo } from '../shared/protocol.js';

/** What the dispatch needs from the floor; narrow on purpose, so a test can fake it. */
export interface DispatchDeps {
  get(id: string): WorkerInfo | undefined;
  /** Prompts the parent's worker; a string means it could not be prompted (not running, stopping...). */
  prompt(id: string, text: string): string | undefined;
  tasks(): QueueTask[];
  departments(): Department[];
  /** The floor's CEO, when one is named: the top of the chain. */
  ceo?(): { name: string; workerId?: string } | undefined;
  /** The worker's latest complete assistant reply (durable record), for rollups. */
  lastReply?(id: string): string | undefined;
  /** Held notices from before a restart, when the floor keeps them. */
  held?(): [string, { parent: string; text: string }][] | undefined;
}

/** Transitions that wake a parent; everything else is the child's own business. */
const NOTIFY = new Set(['needs_input', 'done', 'exited']);
/** One held notice per child is plenty; this is just a sanity bound on the map itself. */
const MAX_HELD = 64;

const IDLE = new Set(['idle', 'done']);

export class LeadDispatch {
  /** The last status each worker was seen in, so transitions — not repeats — fire. */
  private last = new Map<string, string>();
  /** Notices held while a parent works: key -> { parent, text }. Latest only, per key. */
  private held = new Map<string, { parent: string; text: string }>();
  /** Where held notices survive a restart; undefined in tests that don't need it. */
  private persist?: { load(): [string, { parent: string; text: string }][]; save(entries: [string, { parent: string; text: string }][]): void };

  constructor(private deps: DispatchDeps) {
    try {
      const raw = this.deps.held?.();
      if (raw) for (const [key, value] of raw) this.held.set(key, value);
    } catch {
      // A corrupt held file starts empty; notices are at-most-once anyway.
    }
  }

  /** Binds a small durable store for held notices (a floor file), so a restart never drops them. */
  attachPersist(file: string): void {
    this.persist = {
      load: () => {
        try {
          const saved = JSON.parse(readFileSync(file, 'utf8'));
          const parsed: [string, { parent: string; text: string }][] = Array.isArray(saved) ? saved : saved?.held;
          if (!Array.isArray(saved) && Array.isArray(saved?.last)) for (const entry of saved.last) {
            if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') this.last.set(entry[0], entry[1]);
          }
          return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e[0] === 'string' && e[1] && typeof e[1].parent === 'string' && typeof e[1].text === 'string') : [];
        } catch {
          return [];
        }
      },
      save: (entries) => {
        try {
          writeFileSync(file, JSON.stringify({ held: entries, last: [...this.last.entries()] }), { mode: 0o600 });
        } catch {
          // A full disk must not take the office down.
        }
      },
    };
    const loaded = this.persist.load();
    if (loaded.length && this.held.size === 0) for (const [key, value] of loaded) this.held.set(key, value);
  }

  private saveHeld() {
    this.persist?.save([...this.held.entries()].slice(-MAX_HELD));
  }

  /** Forgets a worker that left; a parent that went home drops whatever was held for it. */
  onWorkerGone(workerId: string) {
    this.last.delete(workerId);
    this.held.delete(workerId);
    for (const [key, held] of this.held) if (held.parent === workerId) this.held.delete(key);
    this.saveHeld();
  }

  /** Called with every worker update the floor sees; forwards transitions up the chain. */
  onWorker(info: WorkerInfo) {
    const previous = this.last.get(info.id);
    this.last.set(info.id, info.status);
    // A transition to idle/done on a manager or the CEO flushes whatever their children held; a
    // manager's own finished turn also reports upward, so its reviewed answer has a route to the CEO.
    const isManager = this.deps.departments().some((d) => d.lead?.workerId === info.id);
    const isCeo = this.deps.ceo?.()?.workerId === info.id;
    if ((isManager || isCeo) && previous !== info.status) this.saveHeld();
    if ((isManager || isCeo) && IDLE.has(info.status)) this.flush(info.id);
    if (isManager && info.status === 'done' && previous !== 'done') this.selfRollup(info);
    if (previous === info.status || !NOTIFY.has(info.status)) return;
    const parent = this.parentOf(info.id);
    if (!parent || parent === info.id) return;
    const line = this.notice(info);
    this.deliver(parent, info.id, line);
    this.rollUpToCeo(parent, line);
  }

  /** A manager's own finished turn rolls up to the CEO: its last reply (the reviewed result), not just a status. */
  private selfRollup(mgr: WorkerInfo) {
    const dept = this.deps.departments().find((d) => d.lead?.workerId === mgr.id);
    if (!dept?.lead?.objective) return;
    const ceo = this.deps.ceo?.();
    if (!ceo?.workerId || !this.deps.get(ceo.workerId)) return;
    const reply = this.deps.lastReply?.(mgr.id);
    const what = reply ? reply.replace(/\s+/g, ' ').trim().slice(0, 300) : (mgr.activity ?? 'see their terminal for the full answer.');
    this.deliver(ceo.workerId, `rollup-self:${mgr.id}`, `📋 ${dept.lead.name} (${dept.name}) reports: ${what}`);
  }

  /** The task a worker is seated for: the live one when there is a choice — a retried or reused worker has older done tasks too. */
  private taskFor(childId: string): QueueTask | undefined {
    const mine = this.deps.tasks().filter((t) => t.workerId === childId && (t.parentId || t.dept));
    return mine.sort((a, b) => Number(b.status !== 'done') - Number(a.status !== 'done') || (b.startedAt ?? b.addedAt) - (a.startedAt ?? a.addedAt))[0];
  }

  /** One bounded line the parent can act on. */
  private notice(child: WorkerInfo): string {
    const task = this.taskFor(child.id);
    const job = task ? `“${task.title}”` : 'its task';
    if (child.status === 'needs_input') return `📣 ${child.name} stopped on ${job}${child.activity ? ` — ${child.activity}` : ''}. It needs a person: say what's needed or answer in its terminal.`;
    if (child.status === 'done') return `📣 ${child.name} ended its turn on ${job}${task?.pr ? ` — PR #${task.pr.number} opened (not yet reviewed)` : ''}. Check the result and say what's next.`;
    return `📣 ${child.name} stopped before finishing ${job}${task?.error ? ` — ${task.error}` : ''}. Decide: requeue it or send it home.`;
  }

  /**
   * A manager with an active CEO objective rolls its children's lines up, condensed — so the CEO
   * sees results and blockers without each child's full detail, and only ever upward (a notice
   * never routes back down, so no circular loops).
   */
  private rollUpToCeo(managerId: string, line: string) {
    const ceo = this.deps.ceo?.();
    if (!ceo?.workerId || ceo.workerId === managerId) return;
    const dept = this.deps.departments().find((d) => d.lead?.workerId === managerId);
    if (!dept?.lead?.objective || !this.deps.get(ceo.workerId)) return;
    this.deliver(ceo.workerId, `rollup:${managerId}`, `📋 ${dept.lead.name} (${dept.name}): ${line.replace(/^📣 /, '')}`);
  }

  /** Holds one notice under `key`, or delivers it now when the parent can take a prompt. */
  hold(parentId: string, key: string, text: string) {
    this.deliver(parentId, key, text);
  }

  /** Delivers now when the parent can take a prompt; holds one coalesced notice per key otherwise. */
  private deliver(parentId: string, key: string, text: string) {
    const parent = this.deps.get(parentId);
    if (!parent) return;
    if (IDLE.has(parent.status)) {
      const err = this.deps.prompt(parentId, text);
      if (!err) {
        this.held.delete(key);
        this.saveHeld();
        return;
      }
      // Could not reach it (stopping, gone): treat as unreachable rather than replaying later.
      if (err !== 'Worker is not running') return;
    }
    if (this.held.size >= MAX_HELD) this.held.delete(this.held.keys().next().value!);
    this.held.set(key, { parent: parentId, text });
    this.saveHeld();
  }

  /** A task ended with no worker transition to carry it (killed, or never started): tell the parent. */
  onTaskFinished(task: QueueTask) {
    if (task.outcome !== 'killed' && task.outcome !== 'failed') return;
    const parent = this.parentOfTask(task);
    if (!parent) return;
    const job = `“${task.title}”`;
    const line =
      task.outcome === 'killed'
        ? `📣 ${task.workerName ?? 'Its worker'} was sent home mid-job on ${job}. Decide: requeue it or drop it.`
        : `📣 Nobody could start ${job}${task.error ? ` — ${task.error}` : ''}. Look into it before requeuing.`;
    this.deliver(parent, task.workerId ?? task.id, line);
    this.rollUpToCeo(parent, line);
  }

  /**
   * Sends everything a parent held while working. Each item re-checks that the parent is still
   * idle or done: a prompt can start a turn, and whatever comes next must wait for the next one,
   * not be typed into a busy terminal. Hard failures drop the rest (never replayed).
   */
  private flush(leadId: string) {
    for (const [key, held] of [...this.held]) {
      if (held.parent !== leadId) continue;
      const parent = this.deps.get(leadId);
      if (!parent) {
        this.held.delete(key);
        continue;
      }
      if (!IDLE.has(parent.status)) return; // busy again: keep the rest for the next turn
      this.held.delete(key);
      this.saveHeld();
      const err = this.deps.prompt(leadId, held.text);
      if (err) {
        this.saveHeld();
        return; // it stopped mid-flush: the rest stay held, never replayed
      }
    }
  }

  /** The manager a task reports to: its delegating parent, else the department's live manager. */
  private parentOfTask(task: QueueTask): string | undefined {
    if (task.parentId && this.deps.get(task.parentId)) return task.parentId;
    if (task.dept) {
      const lead = this.deps.departments().find((d) => d.id === task.dept)?.lead;
      if (lead?.workerId && this.deps.get(lead.workerId)) return lead.workerId;
    }
    return undefined;
  }

  /** The parent worker to report this child to. */
  private parentOf(childId: string): string | undefined {
    const task = this.taskFor(childId);
    return task ? this.parentOfTask(task) : undefined;
  }
}
