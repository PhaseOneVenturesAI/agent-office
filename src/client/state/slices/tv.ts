import type { TvVideo } from '../../../shared/tv';
import type { Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** The YouTube video on the office TV; `since` is when it started, on performance.now()'s clock. */
    tv: (TvVideo & { since: number }) | null;
  }
  interface Topics {
    tv: true;
  }
}

/** When the video started on this page's clock: from the office's clock once it's known (see the jukebox slice), else from `elapsed`. */
function setTv(s: Store, v: TvVideo | null) {
  s.tv = v ? { ...v, since: s.clock ? v.startedAt - s.clock.offset : performance.now() - v.elapsed } : null;
}

export const tv: Slice = {
  init(s) {
    s.tv = null;
  },
  on: {
    tv(s, m) {
      setTv(s, m.state.video);
      return ['tv'];
    },
    pong(s) {
      // The jukebox's slice has just compared the clocks again.
      if (!s.tv) return;
      const was = s.tv.since;
      setTv(s, s.tv);
      if (Math.abs(s.tv.since - was) > 250) return ['tv'];
    },
  },
  enter(s, v) {
    setTv(s, v.tv.video);
    return ['tv'];
  },
};
