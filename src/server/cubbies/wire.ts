import { createHash, createHmac } from 'node:crypto';
import { type CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
export const cubbyKey = (token: string) => createHash('sha256').update(token).digest('hex');
export function relaySignature(key: string, frame: Omit<CubbyRelayFrame, 'signature'>): string {
  const f = frame as Record<string, unknown>;
  return createHmac('sha256', key).update(JSON.stringify([f.t, f.cubbyId, f.floorId, f.ownerId, f.connectionId, f.computerId, null, null, null, null])).digest('hex');
}
