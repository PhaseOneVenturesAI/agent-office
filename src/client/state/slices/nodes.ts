import type { NodesState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The satellites: the team's joined computers, who's online and what they could run. */
    nodes: NodesState;
  }
  interface Topics {
    nodes: true;
  }
}

export const nodes: Slice = {
  init(s) {
    s.nodes = { nodes: [] };
  },
  on: {
    nodes(s, m) {
      s.nodes = m.state;
      return ['nodes'];
    },
  },
};
