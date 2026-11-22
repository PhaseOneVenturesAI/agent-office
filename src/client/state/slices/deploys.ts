import type { DeploysState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The office's Cloudflare deployments, for the 🚀 Deploy board. */
    deploys: DeploysState;
  }
  interface Topics {
    deploys: true;
  }
}

export const deploys: Slice = {
  init(s) {
    s.deploys = { configured: false, items: [] };
  },
  on: {
    deploys(s, m) {
      s.deploys = m.state;
      return ['deploys'];
    },
  },
};
