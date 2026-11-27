import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jsonFile } from '../cubbies/local/io.js';
const file = (home: string, origin: string) => path.join(home, '.agent-office/link', createHash('sha256').update(origin).digest('hex') + '.json');
export function readToken(home: string, origin: string): string | undefined {
  try {
    const p = file(home, origin), saved = jsonFile(p, 2048);
    if (saved.origin !== origin || typeof saved.token !== 'string' || !/^ao_node_[a-f0-9]{48}$/.test(saved.token)) throw Error('Invalid stored Mac link');
    chmodSync(path.dirname(p), 0o700); chmodSync(p, 0o600); return saved.token;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
}
export function saveToken(home: string, origin: string, token: string) {
  if (!/^ao_node_[a-f0-9]{48}$/.test(token)) throw Error('Invalid link token');
  const p = file(home, origin);
  mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); chmodSync(path.dirname(p), 0o700);
  writeFileSync(p + '.tmp', JSON.stringify({ origin, token }), { mode: 0o600 }); chmodSync(p + '.tmp', 0o600); renameSync(p + '.tmp', p);
}
/** Only a confirmed websocket revocation removes the credential used by that connection. */
export function forgetToken(home: string, origin: string, token: string) {
  if (readToken(home, origin) === token) unlinkSync(file(home, origin));
}
