import type { CostwallState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The cost wall: who is spending what, per person and per provider. */
    costwall: CostwallState;
  }
  interface Topics {
    costwall: true;
  }
}

const zero = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };

export const costwall: Slice = {
  init(s) {
    s.costwall = {
      rows: [],
      office: { ...zero },
      costKnown: true,
      ledger: { total: { ...zero }, today: { ...zero }, day: '', pauseHiring: false },
    };
  },
  on: {
    costwall(s, m) {
      s.costwall = m.state;
      return ['costwall'];
    },
  },
};
