import type { HygieneState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The hygiene watchdog's report: unpushed work, stale worktrees, idle workers. */
    hygiene: HygieneState;
  }
  interface Topics {
    hygiene: true;
  }
}

export const hygiene: Slice = {
  init(s) {
    s.hygiene = { floors: [], findings: 0 };
  },
  on: {
    hygiene(s, m) {
      s.hygiene = m.state;
      return ['hygiene'];
    },
  },
};
