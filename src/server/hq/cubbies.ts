import type { HQProject } from '../../shared/protocol/hq.js';
import type { CubbyInterior } from '../../shared/protocol/cubbies.js';
import type { CubbyRecord } from '../cubbies/records.js';
import type { PitchStore } from '../pitch/store.js';
interface Observation { projects?: HQProject[]; interior: Pick<CubbyInterior, 'observedAt' | 'ownerDevices'> }
/** Last observed owner snapshot across still-existing cubbies. Interiors never leave this projection. */
export function hqRecords(records: Iterable<CubbyRecord>, live: ReadonlyMap<string, Observation>, owner: string, valid: (floor: string) => boolean) {
  return [...records].filter(r => r.owner === owner && valid(r.floorId))
    .sort((a, b) => (live.get(b.id)?.interior.observedAt ?? 0) - (live.get(a.id)?.interior.observedAt ?? 0));
}
export function hqCubbyPitch(records: CubbyRecord[], live: ReadonlyMap<string, Observation>, pitches: PitchStore, mine: boolean) {
  for (const r of records) {
    const view = r.computerId && pitches.view(r.id, r.floorId, r.computerId);
    if (view) return { ...view, ...(mine ? { ownerDevices: live.get(r.id)?.interior.ownerDevices } : {}) };
  }
}
