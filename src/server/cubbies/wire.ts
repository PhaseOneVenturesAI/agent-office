import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { ownerChatEncoding, type CubbyOwnerPayload, type CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
export const cubbyKey = (token: string) => createHash('sha256').update(token).digest('hex');
export function relaySignature(key: string, frame: Omit<CubbyRelayFrame, 'signature'>): string {
  const f = frame as Record<string, unknown>;
  return createHmac('sha256', key).update(JSON.stringify([f.t, f.cubbyId, f.floorId, f.ownerId, f.connectionId, f.computerId, f.requestId ?? null, f.at ?? null, f.text ?? null, f.ownerSig ?? null])).digest('hex');
}
export function verifyRelay(key: string, frame: CubbyRelayFrame): boolean {
  if (typeof frame.signature !== 'string' || !/^[0-9a-f]{64}$/.test(frame.signature)) return false;
  return timingSafeEqual(Buffer.from(frame.signature, 'hex'), Buffer.from(relaySignature(key, frame), 'hex'));
}

/** Only canonical base64url SPKI for ECDSA P-256 is accepted from the local command. */
export function ownerPublicKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{100,160}$/.test(value)) throw new Error('--owner-key must be a base64url P-256 SPKI public key');
  try {
    const key = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      key.export({ format: 'der', type: 'spki' }).toString('base64url') !== value) throw new Error('Invalid key');
    return key;
  } catch { throw new Error('--owner-key must be a base64url P-256 SPKI public key'); }
}
export function ownerFingerprint(key: string): string {
  ownerPublicKey(key);
  return createHash('sha256').update(Buffer.from(key, 'base64url')).digest('hex').slice(0, 32);
}
export function verifyOwner(key: string, frame: CubbyOwnerPayload & { ownerSig?: unknown }): boolean {
  if (typeof frame.ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(frame.ownerSig)) return false;
  try {
    const sig = Buffer.from(frame.ownerSig, 'base64url');
    if (sig.toString('base64url') !== frame.ownerSig) return false;
    return verify('sha256', Buffer.from(ownerChatEncoding(frame)),
      { key: ownerPublicKey(key), dsaEncoding: 'ieee-p1363' }, sig);
  } catch { return false; }
}
