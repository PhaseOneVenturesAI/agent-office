import type { ChildProcess } from 'node:child_process';

/** Stop only this Office-owned ACP child, and resolve only once its exit was observed. */
export function stopAcpChild(child: ChildProcess | undefined, requestClose: () => void): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timers: NodeJS.Timeout[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      child.off('exit', exited); child.off('error', failed);
      if (error) reject(error); else resolve();
    };
    const exited = () => finish();
    // Failed spawn has no child to reap. Other process errors cannot prove it exited.
    const failed = (error: Error) => { if (!child.pid) finish(); else finish(error); };
    const signal = (value: NodeJS.Signals) => {
      if (settled) return;
      try { child.kill(value); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    child.once('exit', exited); child.once('error', failed);
    try { requestClose(); } catch { /* Still terminate if the ACP pipe has already broken. */ }
    // Referenced timers keep shutdown alive even if the child's stdio was already detached.
    timers.push(setTimeout(() => signal('SIGTERM'), 500));
    timers.push(setTimeout(() => signal('SIGKILL'), 1500));
    timers.push(setTimeout(() => finish(new Error(`ACP child ${child.pid ?? 'unknown'} did not exit after SIGKILL`)), 2500));
  });
}

/** Wait for every child, even when one fails; a cleanup error must not abandon the others. */
export async function settleShutdown(pending: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(pending);
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, 'ACP cleanup did not complete; inspect the reported child processes before restarting');
}

/** Includes children already being sent home when an Office shutdown arrives. */
export class AcpClosures {
  private pending = new Set<Promise<void>>();
  close(session: { close(): Promise<void> }): Promise<void> {
    const closing = session.close();
    this.pending.add(closing);
    void closing.then(() => this.pending.delete(closing), () => this.pending.delete(closing));
    return closing;
  }
  wait(): Promise<void> { return settleShutdown([...this.pending]); }
}
