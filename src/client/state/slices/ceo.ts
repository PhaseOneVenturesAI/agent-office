import type { CeoState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The floor's CEO: one persistent identity per project, directing the managers. */
    ceo: CeoState;
  }
  interface Topics {
    ceo: true;
  }
}

const EMPTY_CEO: CeoState = {};

export const ceo: Slice = {
  init(s) {
    s.ceo = EMPTY_CEO;
  },
  on: {
    ceo(s, m) {
      s.ceo = m.state;
      return ['ceo'];
    },
  },
  enter(s, v) {
    s.ceo = v.ceo ?? EMPTY_CEO;
    return ['ceo'];
  },
};
