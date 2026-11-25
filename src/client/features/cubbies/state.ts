import type { CubbiesState, CubbyInfo } from '../../../shared/protocol/cubbies';

/** No cubby hall: what a floor without one (or an office without the feature) has. */
export const NO_CUBBIES: CubbiesState = { enabled: false, cubbies: [], setupAllowed: false };

/**
 * The state as the page keeps it. The server never sends anyone else's interior, and this drops one that
 * somehow came anyway (an interior on a cubby that isn't yours), so nothing downstream can draw it.
 */
export function cleanCubbies(x: CubbiesState | undefined | null): CubbiesState {
  if (!x || typeof x !== 'object' || !x.enabled || !Array.isArray(x.cubbies)) return { ...NO_CUBBIES, cubbies: [] };
  const cubbies: CubbyInfo[] = [];
  for (const c of x.cubbies) {
    if (!c || typeof c.id !== 'string' || !Number.isInteger(c.slot)) continue;
    const { interior, ...summary } = c;
    cubbies.push(c.mine === true && interior ? { ...summary, mine: true, interior } : { ...summary, mine: c.mine === true });
  }
  return { enabled: true, ...(x.floorId ? { floorId: x.floorId } : {}), cubbies, setupAllowed: x.setupAllowed === true };
}

