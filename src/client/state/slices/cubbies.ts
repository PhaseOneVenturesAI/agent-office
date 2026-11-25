import type { Slice } from '../store';
import type { CubbiesState, CubbyInfo, CubbyPerson } from '../../../shared/protocol/cubbies';

declare module '../store' {
  interface Store { cubbies: CubbiesState }
  interface Topics { cubbies: true }
}
/** No cubby hall: what a floor without one (or an office without the feature) has. */
const NO_CUBBIES: CubbiesState = { enabled: false, cubbies: [], setupAllowed: false };

/** Who's watching or knocking, as the owner's page keeps it: an account and a name each, nothing else. */
function people(x: unknown): CubbyPerson[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x.filter((p) => p && typeof p.accountId === 'string' && typeof p.name === 'string').map((p) => ({ accountId: p.accountId, name: p.name }));
}

/**
 * The state as the page keeps it. The server never sends anyone else's interior but to a watcher the
 * owner let in (watching), and this drops one that somehow came anyway, so nothing downstream can draw
 * it. Only your own cubby keeps who's watching and knocking.
 */
function cleanCubbies(x: CubbiesState | undefined | null): CubbiesState {
  if (!x || typeof x !== 'object' || !x.enabled || !Array.isArray(x.cubbies)) return { ...NO_CUBBIES, cubbies: [] };
  const cubbies: CubbyInfo[] = [];
  for (const c of x.cubbies) {
    if (!c || typeof c.id !== 'string' || !Number.isInteger(c.slot)) continue;
    const { interior, watching, watchers, knocking, ...summary } = c;
    const mine = c.mine === true;
    const watch = !mine && watching === true;
    const own = mine ? { ...(people(watchers) ? { watchers: people(watchers) } : {}), ...(people(knocking) ? { knocking: people(knocking) } : {}) } : {};
    cubbies.push({ ...summary, mine, ...(watch ? { watching: true as const } : {}), ...own, ...((mine || watch) && interior ? { interior } : {}) });
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
