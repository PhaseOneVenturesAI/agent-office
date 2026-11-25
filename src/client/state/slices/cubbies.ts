import type { CubbiesState, CubbyInfo } from '../../../shared/protocol/cubbies';
import type { FloorView, ServerMsg } from '../../../shared/protocol';
import type { Handlers, Slice, Store } from '../store';

declare module '../store' {
  interface Store {
    /** The cubby hall on the floor you're on: six slots, and the inside of your own (see features/cubbies). */
    cubbies: CubbiesState;
  }
  interface Topics {
    cubbies: true;
  }
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

/** The `cubbies` message, before protocol.ts's ServerMsg has it (the root adds it); see `on` below. */
type CubbiesMsg = { t: 'cubbies'; state: CubbiesState };

function take(s: Store, m: CubbiesMsg) {
  // A late answer for the floor you just left isn't this floor's.
  if (m.state?.floorId && s.floor && m.state.floorId !== s.floor) return;
  s.cubbies = cleanCubbies(m.state);
  return ['cubbies'] as const;
}

export const cubbies: Slice = {
  init(s) {
    s.cubbies = { ...NO_CUBBIES, cubbies: [] };
  },
  // Keyed by the message's type like any slice's; cast because ServerMsg doesn't list `cubbies` until
  // the root adds CubbiesServerMsg to protocol.ts's union, after which the cast is a no-op.
  on: { cubbies: (s: Store, m: ServerMsg) => take(s, m as unknown as CubbiesMsg) } as unknown as Handlers,
  enter(s, v) {
    // FloorView.cubbies is the root's to add; a floor without it has no hall.
    s.cubbies = cleanCubbies((v as FloorView & { cubbies?: CubbiesState }).cubbies);
    return ['cubbies'];
  },
};
