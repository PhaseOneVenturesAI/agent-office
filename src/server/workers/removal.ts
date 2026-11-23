import type { WorkerInfo } from '../../shared/protocol.js';
import type { WorktreeCleanup } from '../worktrees.js';
import type { WorkerContext } from './types.js';

export type RemovalResult = { note?: string; error?: string };
interface RemovalActions {
  forget(id: string): void;
  files(id: string): void;
  sendHome(info: WorkerInfo, cleanup?: WorktreeCleanup, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<RemovalResult>;
}

/** Keep the record and seat reserved until child stop succeeds; share concurrent requests. */
export class WorkerRemovals {
  private pending = new Map<string, Promise<RemovalResult>>();
  constructor(private ctx: WorkerContext, private actions: RemovalActions) {}
  remove(id: string, cleanup?: WorktreeCleanup, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<RemovalResult> {
    const existing = this.pending.get(id);
    if (existing) return existing;
    const task = this.run(id, cleanup, landed, landedRepos);
    this.pending.set(id, task);
    void task.then(() => this.pending.delete(id), () => this.pending.delete(id));
    return task;
  }
  private async run(id: string, cleanup?: WorktreeCleanup, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<RemovalResult> {
    const w = this.ctx.workers.get(id);
    if (!w) return {};
    if (w.stopping) return { error: 'This worker is already stopping or recovering; its seat remains reserved.' };
    w.stopping = true;
    try {
      if (w.dsh) await this.ctx.closeAcp(w.dsh);
    } catch (error) {
      w.stopping = false;
      this.ctx.persist();
      return { error: `ACP worker did not stop; its seat and workspace were kept: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.ctx.workers.delete(id);
    this.actions.forget(id);
    clearTimeout(w.scanTimer);
    const proc = w.pty;
    w.pty = undefined; w.dsh = undefined;
    try { proc?.kill(); } catch { /* Already gone. */ }
    w.term?.dispose();
    this.actions.files(id);
    this.ctx.events.remove(id, w.info);
    this.ctx.persist();
    return this.actions.sendHome(w.info, cleanup, landed, landedRepos);
  }
}
