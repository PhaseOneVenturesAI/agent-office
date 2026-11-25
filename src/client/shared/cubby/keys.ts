import { ownerChatEncoding, type CubbyOwnerPayload } from '../../../shared/protocol/cubbies';

export interface OwnerDeviceKey {
  privateKey: CryptoKey;
  publicKey: string;
  fingerprint: string;
}
const pending = new Map<string, Promise<OwnerDeviceKey>>();
const base64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Non-extractable private CryptoKeys are structured-cloned into origin-local IndexedDB. */
async function loadOrCreate(scope: string): Promise<OwnerDeviceKey> {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw new Error('Owner keys need HTTPS and browser storage.');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('agent-office-cubby-owner-keys', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot open owner key storage.'));
    request.onblocked = () => reject(new Error('Close other Office tabs to open owner key storage.'));
  });
  try {
    const existing = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const request = tx.objectStore('keys').get(scope);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error('Cannot read owner key storage.'));
    });
    let pair = existing;
    if (!pair) {
      const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      // Concurrent tabs may generate a candidate, but a single read/write transaction picks one winner.
      pair = await new Promise<CryptoKeyPair>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        const keys = tx.objectStore('keys');
        const request = keys.get(scope);
        let selected: CryptoKeyPair;
        request.onsuccess = () => {
          selected = request.result ?? generated;
          if (!request.result) keys.add(selected, scope);
        };
        tx.oncomplete = () => resolve(selected);
        tx.onabort = tx.onerror = () => reject(new Error('Cannot save owner key. Enable browser storage and try again.'));
      });
    }
    if (!(pair.privateKey instanceof CryptoKey) || pair.privateKey.extractable || pair.privateKey.type !== 'private' ||
      pair.privateKey.algorithm.name !== 'ECDSA' || (pair.privateKey.algorithm as EcKeyAlgorithm).namedCurve !== 'P-256') {
      throw new Error('Invalid stored owner key. Use a new browser profile and re-pin locally.');
    }
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
    return { privateKey: pair.privateKey, publicKey: base64url(spki),
      fingerprint: [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  } finally { db.close(); }
}

/** Account names are the Office's unique sign-in identities; browser origins isolate offices. */
export function ownerDeviceKey(account: string | undefined, origin = location.origin): Promise<OwnerDeviceKey> {
  if (!account) return Promise.reject(new Error('Sign in to your own account to use an owner key.'));
  const scope = JSON.stringify([origin, account]);
  let key = pending.get(scope);
  if (!key) {
    key = loadOrCreate(scope).catch((error) => { pending.delete(scope); throw error; });
    pending.set(scope, key);
  }
  return key;
}
export const displayFingerprint = (fingerprint: string) => fingerprint.match(/.{1,4}/g)?.join('-') ?? fingerprint;
export async function signOwnerChat(key: OwnerDeviceKey, payload: CubbyOwnerPayload): Promise<string> {
  return base64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey,
    new TextEncoder().encode(ownerChatEncoding(payload))));
}
