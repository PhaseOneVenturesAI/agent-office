// One provider's plan limits (the 5-hour session and the week), polled for the meter under the
// workers. Reading starts no conversation and costs nothing: each provider's read (claude.ts,
// codex.ts, kimi.ts) asks its CLI or its account endpoint for the numbers its own usage screen
// shows, and the CLI deals with the sign-in (keychain, token refresh) itself.

import type { PlanLimits } from '../../shared/protocol.js';

const POLL_MS = 2 * 60_000;
/** Someone walking in, or clicking the meter, reads again, at most this often. */
const MIN_GAP_MS = 20_000;
/** No plan limits to show (an API key, signed out): look again much later. */
const NO_PLAN_MS = 30 * 60_000;
/** After this many failed reads in a row (no network, a CLI too old to answer), wait longer. */
const FAILS_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 10 * 60_000;

/** Reads a provider's plan limits once: the numbers, or null when it couldn't give any this time. */
export type LimitsRead = () => Promise<PlanLimits | null>;

export class PlanLimitsReader {
  private limits: PlanLimits = { windows: [], at: 0 };
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastRead = 0;
  private fails = 0;
  private closed = false;

  /**
   * @param read asks the provider for its numbers (null: it couldn't give any)
   * @param wanted whether anyone is in the office to see the numbers; polls are skipped when not
   */
  constructor(
    private read: LimitsRead,
    private wanted: () => boolean,
    private onChange: (limits: PlanLimits) => void,
  ) {
    this.schedule(0);
  }

  get state(): PlanLimits {
    return this.limits;
  }

  /** Reads now, unless a read is running or one just finished. */
  refresh() {
    if (this.running || Date.now() - this.lastRead < MIN_GAP_MS) return;
    this.schedule(0);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref();
  }

  private async tick() {
    if (!this.wanted()) return this.schedule(POLL_MS);
    this.running = true;
    const answer = await this.read();
    this.running = false;
    this.lastRead = Date.now();
    if (this.closed) return;
    let next = POLL_MS;
    if (answer === null) {
      if (++this.fails >= FAILS_BEFORE_BACKOFF) {
        this.fails = 0;
        next = BACKOFF_MS;
      }
    } else {
      this.fails = 0;
      this.limits = answer;
      if (!this.limits.windows.length) next = NO_PLAN_MS;
      this.onChange(this.limits);
    }
    this.schedule(next);
  }
}
