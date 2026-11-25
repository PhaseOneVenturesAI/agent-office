import { ownerFeedbackEncoding, type DraftFeedbackPayload } from '../../src/shared/protocol/drafts.js';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ownerChatEncoding, ownerDeviceEncoding, type CubbyDevicePayload, type CubbyOwnerPayload } from '../../src/shared/protocol/cubbies.js';
export function testOwnerKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signed = (text: string) => sign('sha256', Buffer.from(text), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return {
    ownerKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    sign: (frame: CubbyOwnerPayload) => signed(ownerChatEncoding(frame)),
    signFeedback: (frame: DraftFeedbackPayload) => signed(ownerFeedbackEncoding(frame)),
    signDevice: (frame: CubbyDevicePayload) => signed(ownerDeviceEncoding(frame)),
  };
}
export const owner = testOwnerKey();
