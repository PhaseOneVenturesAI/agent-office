import type { DepartmentsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The floor's departments: briefs, rosters, brand assets, and the project's instruction sources. */
    departments: DepartmentsState;
  }
  interface Topics {
    departments: true;
  }
}

const EMPTY_DEPARTMENTS: DepartmentsState = { departments: [], sources: [] };

export const departments: Slice = {
  init(s) {
    s.departments = EMPTY_DEPARTMENTS;
  },
  on: {
    departments(s, m) {
      s.departments = m.state;
      return ['departments'];
    },
  },
  enter(s, v) {
    s.departments = v.departments ?? EMPTY_DEPARTMENTS;
    return ['departments'];
  },
};
