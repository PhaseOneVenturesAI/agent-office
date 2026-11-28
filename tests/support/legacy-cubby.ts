import { randomUUID } from 'node:crypto';
import type { Cubbies } from '../../src/server/cubbies/index.js';
import type { Nodes } from '../../src/server/nodes.js';
import { sanitizeLook, lookFromSeed, type Look } from '../../src/shared/avatar.js';
import { savedOwnerColor } from '../../src/shared/personal-agents/appearance.js';
/** Seed pre-v8 persisted rooms, without exposing the removed setup API. */
export function legacyCubby(cubbies: Cubbies, floorId: string, owner: string, slot: number, leadName: string, look: Look, color?: string) {
  const nodes = (cubbies as unknown as { nodes: Nodes }).nodes;
  const invite = nodes.invite('Legacy cubby', 'private', owner, true), id = randomUUID();
  cubbies.records.rows.set(id, { id, floorId, owner, slot, leadName, look: sanitizeLook(look, lookFromSeed(owner)), nodeId: invite.id, ownerColor: savedOwnerColor(color) ?? cubbies.records.color(owner) });
  if (color) cubbies.records.setColor(owner, savedOwnerColor(color)!);
  cubbies.records.save();
  return { id, floorId, token: invite.token };
}
