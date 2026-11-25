import type { Slice } from '../store';
import type { CubbiesState, CubbyInfo } from '../../../shared/protocol/cubbies';

declare module '../store' {
  interface Store { cubbies: CubbiesState }
  interface Topics { cubbies: true }
}
/** No cubby hall: what a floor without one (or an office without the feature) has. */
const NO_CUBBIES: CubbiesState = { enabled: false, cubbies: [], setupAllowed: false };

/**
 * The state as the page keeps it. The server never sends anyone else's interior, and this drops one that
 * somehow came anyway (an interior on a cubby that isn't yours), so nothing downstream can draw it.
 */
function cleanCubbies(x: CubbiesState | undefined | null): CubbiesState {
  if (!x || typeof x !== 'object' || !x.enabled || !Array.isArray(x.cubbies)) return { ...NO_CUBBIES, cubbies: [] };
  const cubbies: CubbyInfo[] = [];
  for (const c of x.cubbies) {
    if (!c || typeof c.id !== 'string' || !Number.isInteger(c.slot)) continue;
    const { interior, ...summary } = c;
    cubbies.push(c.mine === true && interior ? { ...summary, mine: true, interior } : { ...summary, mine: c.mine === true });
  }
  return { enabled: true, ...(x.floorId ? { floorId: x.floorId } : {}), cubbies, setupAllowed: x.setupAllowed === true };
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
