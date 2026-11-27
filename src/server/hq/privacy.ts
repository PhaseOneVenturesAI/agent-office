import type { CubbyInterior } from '../../shared/protocol/cubbies.js';
/** Matching identities and sort timestamps are connector-to-server metadata, never cubby UI data. */
export function cubbyWithoutHQMetadata(interior: CubbyInterior): CubbyInterior {
  return { ...interior, agents: interior.agents.map(({ lead: _lead, startedAt: _at, ...a }) => a) };
}
