import { generateKeyPairSync, sign } from 'node:crypto';
import { ownerChatEncoding, type CubbyOwnerPayload } from '../../src/shared/protocol/cubbies.js';
export function testOwnerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    ownerKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    sign: (frame: CubbyOwnerPayload) => sign('sha256', Buffer.from(ownerChatEncoding(frame)),
      { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}
export const owner = testOwnerKey();
