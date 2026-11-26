import { ownerVerdictEncoding, type PitchVerdictPayload } from '../../../shared/protocol/pitch';
import type { OwnerDeviceKey } from '../cubby/keys';
export async function signVerdict(key: OwnerDeviceKey, payload: PitchVerdictPayload) {
  const bytes = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(ownerVerdictEncoding(payload)));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
