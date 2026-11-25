import type { LimitsByProvider, Usage, UsageState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    usage: UsageState;
    /** Each provider's plan limits (Claude, Codex, Kimi), as far as they can be read. */
    limits: LimitsByProvider;
  }
  interface Topics {
    usage: true;
    limits: true;
  }
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 });

/** What the workers have spent, and how much of each plan's limits is left. */
export const usage: Slice = {
  init(s) {
    s.usage = { total: zeroUsage(), today: zeroUsage(), day: '', pauseHiring: false };
    s.limits = {};
  },
  on: {
    welcome(s, m) {
      s.usage = m.usage;
      s.limits = m.limits;
      return ['usage', 'limits'];
    },
    usage(s, m) {
      s.usage = m.state;
      return ['usage'];
    },
    limits(s, m) {
      s.limits = m.state;
      return ['limits'];
    },
  },
};
