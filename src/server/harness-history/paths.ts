import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const MAX_HARNESS_BYTES = 256_000;
const EXTENSIONS = new Set(['.md', '.txt', '.json', '.toml', '.yaml', '.yml']);
const PRIVATE = /(^|\/)(?:credentials?|secrets?|private|id_rsa|id_ed25519|accounts?|homes?|sessions?|auth|tokens?)(?:[\/._-]|$)/i;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
export class HarnessSourceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
export function allowedHarnessSource(rel: string): boolean {
  if (!rel || rel.length > 300 || !/^[\w .@+\-/]+$/.test(rel) || !EXTENSIONS.has(path.extname(rel)) || PRIVATE.test(rel)) return false;
  return rel.split('/').every((part) => !!part && !part.startsWith('.') && !SKIP.has(part));
}
export function checkRoot(root: string): void {
  const st = lstatSync(root);
  if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(root) !== root) throw new HarnessSourceError(400, 'Harness storage must remain a real directory.');
}
/** All ancestors and the final file must remain regular, canonical, unaliased sources. */
export function harnessSourcePath(root: string, rel: string, legacy = false): string {
  if (!allowedHarnessSource(rel)) throw new HarnessSourceError(400, 'Choose a supported Harness text source; private and provider-home files are excluded.');
  checkRoot(root);
  const parts = (legacy ? `${rel}.bak` : rel).split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.nlink !== 1)) throw new HarnessSourceError(400, 'Links and non-regular files are not Harness sources.');
      if (!realpathSync(current).startsWith(root + path.sep)) throw new HarnessSourceError(400, 'The source is outside this Harness.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && i === parts.length - 1) return current;
      if (error instanceof HarnessSourceError) throw error;
      throw new HarnessSourceError(404, 'The source parent is missing. Restore its safe folder before restoring this source.');
    }
  }
  return current;
}
export function safeHarnessText(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_HARNESS_BYTES || text.includes('\0')) throw new HarnessSourceError(413, 'Harness sources must be text of at most 256 KB.');
  if (Buffer.from(text, 'utf8').toString('utf8') !== text) throw new HarnessSourceError(400, 'Text contains invalid Unicode and was not saved.');
  if (/-----BEGIN [^-]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(text)) throw new HarnessSourceError(400, 'This source appears to contain a credential and cannot be opened or saved here.');
}
export function readHarnessSource(root: string, rel: string, legacy = false): { text: string | null; mode: number } {
  const file = harnessSourcePath(root, rel, legacy);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: null, mode: 0o600 }; throw error; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_HARNESS_BYTES) throw new HarnessSourceError(413, 'Not a regular Harness text source of at most 256 KB.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd)); }
    catch { throw new HarnessSourceError(400, 'This source is not valid UTF-8. Its bytes were preserved.'); }
    safeHarnessText(text);
    return { text, mode: st.mode & 0o777 };
  } finally { closeSync(fd); }
}
