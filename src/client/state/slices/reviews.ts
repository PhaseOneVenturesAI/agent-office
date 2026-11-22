import type { ReviewsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The Review Room: staged deliverables waiting for a verdict, and the ones decided. */
    reviews: ReviewsState;
  }
  interface Topics {
    reviews: true;
  }
}

export const reviews: Slice = {
  init(s) {
    s.reviews = { items: [], pending: 0 };
  },
  on: {
    reviews(s, m) {
      s.reviews = m.state;
      return ['reviews'];
    },
  },
};
