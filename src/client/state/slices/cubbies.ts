import type { Slice } from '../store';
import type { CubbiesState } from '../../../shared/protocol/cubbies';
import { NO_CUBBIES, cleanCubbies } from '../../features/cubbies/state';

declare module '../store' {
  interface Store { cubbies: CubbiesState }
  interface Topics { cubbies: true }
}
export const cubbies: Slice = {
  init(s) { s.cubbies = NO_CUBBIES; },
  on: { cubbies(s, m) {
    if (m.state?.floorId && s.floor && m.state.floorId !== s.floor) return;
    s.cubbies = cleanCubbies(m.state);
    return ['cubbies'];
  } },
  enter(s, v) { s.cubbies = cleanCubbies(v.cubbies); return ['cubbies']; },
};
