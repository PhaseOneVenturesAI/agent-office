/** SIGTERM preserves hosted PTYs; ACP children must be reaped before this process exits. */
export function installShutdownSignals(shutdown: (keep: boolean) => Promise<void>): void {
  let closing = false;
  const stop = async (signal: NodeJS.Signals) => {
    // A repeated signal must not jump past child cleanup in progress.
    if (closing) return;
    closing = true;
    const keep = signal === 'SIGTERM';
    console.log(keep ? '\n  closing the office — hosted terminals keep running; stopping ACP children…' : '\n  closing the office…');
    try {
      await shutdown(keep);
      // Give existing non-ACP socket/terminal cleanup its original final flush interval.
      setTimeout(() => process.exit(0), 300);
    } catch (error) {
      console.error('agent-office: shutdown cleanup failed', error);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}
