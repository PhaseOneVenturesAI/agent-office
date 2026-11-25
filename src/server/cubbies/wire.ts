import { ownerFeedbackEncoding, type DraftFeedbackPayload } from '../../shared/protocol/drafts.js';
import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { deviceCode, ownerChatEncoding, ownerDeviceEncoding, type CubbyDevicePayload, type CubbyOwnerPayload, type CubbyRelayFrame } from '../../shared/protocol/cubbies.js';
export const cubbyKey = (token: string) => createHash('sha256').update(token).digest('hex');
export function relaySignature(key: string, frame: Omit<CubbyRelayFrame, 'signature'>): string {
  const f = frame as Record<string, unknown>;
  return createHmac('sha256', key).update(JSON.stringify([f.t, f.cubbyId, f.floorId, f.ownerId, f.connectionId, f.computerId, f.requestId ?? null, f.at ?? null, f.text ?? null, f.ownerSig ?? null, ...(f.t === 'cubby.feedback' ? [f.cardId] : [])])).digest('hex');
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
function verifySigned(key: string, encoded: string, ownerSig: unknown): boolean {
  if (typeof ownerSig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(ownerSig)) return false;
  try {
    const sig = Buffer.from(ownerSig, 'base64url');
    if (sig.toString('base64url') !== ownerSig) return false;
    return verify('sha256', Buffer.from(encoded), { key: ownerPublicKey(key), dsaEncoding: 'ieee-p1363' }, sig);
  } catch { return false; }
}
export function verifyOwner(key: string, frame: CubbyOwnerPayload & { ownerSig?: unknown }): boolean {
  return verifySigned(key, ownerChatEncoding(frame), frame.ownerSig);
}
/** A change to the trusted devices, signed by one of them. */
export function verifyOwnerDevice(key: string, frame: CubbyDevicePayload & { ownerSig?: unknown }): boolean {
  return verifySigned(key, ownerDeviceEncoding(frame), frame.ownerSig);
}
/** The code a device with this public key shows (the same digits as the browser works out for itself). */
export function ownerDeviceCode(key: string): string {
  return deviceCode(createHash('sha256').update(Buffer.from(key, 'base64url')).digest());
}

export function verifyOwnerFeedback(key: string, frame: DraftFeedbackPayload & { ownerSig?: unknown }): boolean {
  return verifySigned(key, ownerFeedbackEncoding(frame), frame.ownerSig);
}
