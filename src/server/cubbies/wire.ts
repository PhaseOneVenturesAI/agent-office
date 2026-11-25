import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
export const cubbyKey = (token: string) => createHash('sha256').update(token).digest('hex');
export function relaySignature(key: string, frame: Omit<CubbyRelayFrame, 'signature'>): string {
  const f = frame as Record<string, unknown>;
  return createHmac('sha256', key).update(JSON.stringify([f.t, f.cubbyId, f.floorId, f.ownerId, f.connectionId, f.requestId ?? null, f.at ?? null, f.text ?? null])).digest('hex');
}
export function verifyRelay(key: string, frame: CubbyRelayFrame): boolean {
  if (typeof frame.signature !== 'string' || !/^[0-9a-f]{64}$/.test(frame.signature)) return false;
  return timingSafeEqual(Buffer.from(frame.signature, 'hex'), Buffer.from(relaySignature(key, frame), 'hex'));
}
