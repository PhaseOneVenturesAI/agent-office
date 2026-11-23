import { randomUUID } from 'node:crypto';
import type { ApprovalState, ApprovalRequest } from '../../shared/protocol/approvals.js';
import type { Worker } from '../workers/types.js';
import { KimiSession } from '../kimi.js';
import { safeEq } from '../workers/util.js';
import { APPROVAL_WAIT_MS, nativeDecision, nativeRequest } from './native.js';
interface Pending { request: ApprovalRequest; token: string; worker: Worker; resolve: (value: Record<string, unknown>) => void; timer: NodeJS.Timeout; alive: () => boolean }
export class WorkerApprovals {
  private hooks = new Map<string, Pending[]>();
  private closed = false;
  constructor(private workers: Map<string, Worker>) {}
  /** Called only by the authenticated native hook transport, never by a browser. */
  hold(provider: 'claude' | 'codex', workerId: string, token: string, payload: unknown, alive: () => boolean): { result: Promise<Record<string, unknown>>; cancel(): void } | undefined {
    const w = this.workers.get(workerId);
    if (this.closed || !w || !w.pty || w.stopping || w.info.provider !== provider || !safeEq(token, w.hookToken)) return;
    const request = nativeRequest(provider, payload, randomUUID());
    if (!request || (w.info.sessionId && w.info.sessionId !== request.sessionId)) return;
    const queue = this.hooks.get(workerId) ?? [];
    if (queue.length >= 32) return;
    let finish!: (value: Record<string, unknown>) => void;
    const result = new Promise<Record<string, unknown>>((resolve) => { finish = resolve; });
    const entry: Pending = { request, token, worker: w, resolve: finish, alive, timer: setTimeout(() => this.remove(workerId, request.id, {}), APPROVAL_WAIT_MS) };
    entry.timer.unref(); queue.push(entry); this.hooks.set(workerId, queue);
    return { result, cancel: () => this.remove(workerId, request.id, {}) };
  }
  private valid(id: string, entry: Pending) {
    const w = this.workers.get(id);
    return !this.closed && w === entry.worker && !!w.pty && !w.stopping && safeEq(w.hookToken, entry.token) && (!w.info.sessionId || w.info.sessionId === entry.request.sessionId) && entry.alive();
  }
  private prune(id: string) {
    for (const item of [...(this.hooks.get(id) ?? [])]) if (!this.valid(id, item)) this.remove(id, item.request.id, {});
  }
  private remove(id: string, requestId: string, decision: Record<string, unknown>) {
    const list = this.hooks.get(id), index = list?.findIndex((p) => p.request.id === requestId) ?? -1;
    if (!list || index < 0) return;
    const [entry] = list.splice(index, 1); clearTimeout(entry.timer);
    if (!list.length) this.hooks.delete(id);
    entry.resolve(decision);
  }
  state(id: string): ApprovalState {
    this.prune(id);
    const w = this.workers.get(id);
    if (w?.dsh instanceof KimiSession) return w.dsh.approvals();
    const queue = this.hooks.get(id) ?? [];
    if (queue.length) return { request: structuredClone(queue[0].request), queued: queue.length };
    return { queued: 0, fallback: w?.info.status === 'needs_input' ? 'No supported structured request is pending. Use Terminal for this question, setup screen or native approval.' : undefined };
  }
  answer(id: string, requestId: string, optionId: string): string | undefined {
    this.prune(id);
    const w = this.workers.get(id);
    if (!w || w.stopping || this.closed) return 'This agent is no longer available';
    if (w.dsh instanceof KimiSession) return w.dsh.answerApproval(requestId, optionId);
    const entry = this.hooks.get(id)?.[0];
    if (!entry || entry.request.id !== requestId) return 'This approval is no longer current; refresh the conversation';
    if (!entry.request.options.some((o) => o.id === optionId)) return 'That choice is not offered for this request';
    this.remove(id, requestId, nativeDecision(optionId));
  }
  terminal(id: string, requestId: string): string | undefined {
    const state = this.state(id);
    if (state.request?.id !== requestId) return 'This approval is no longer current';
    // ACP's terminal and conversation are views of the same real FIFO request. Leave it pending.
    if (state.request.source === 'permission-hook') this.remove(id, requestId, {});
  }
  observe(id: string, event: string) {
    if (['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(event)) this.cancel(id);
  }
  cancel(id: string) { for (const p of [...(this.hooks.get(id) ?? [])]) this.remove(id, p.request.id, {}); }
  /** Poll only while the panel is subscribed; all ACL checks belong to the handler callback. */
  subscribe(id: string, listener: (state: ApprovalState) => void) {
    // Invoke even without a new request, so revocation closes a formerly authorized view.
    const tick = () => listener(this.state(id));
    const timer = setInterval(tick, 250); timer.unref();
    return () => clearInterval(timer);
  }
  close() { this.closed = true; for (const id of [...this.hooks.keys()]) this.cancel(id); }
}
