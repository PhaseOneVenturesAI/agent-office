import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_CONTEXT_BYTES = 256 * 1024;
export class ContextError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const SECRET = /(^|\/)(?:\.env(?:\.|$)|(?:credentials?|secrets?|private|id_rsa|id_ed25519|accounts?|homes?|sessions?)(?:[\/._-]|$))|\.(?:pem|key|p12|pfx)(?:\.|$)/i;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
export const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
export function allowedSource(rel: string): boolean {
  if (!rel || rel.length > 500 || rel.includes('\\') || /[\x00-\x1f\x7f]/.test(rel) || !/\.(md|markdown)$/i.test(rel) || SECRET.test(rel)) return false;
  const parts = rel.split('/');
  const claudeInstruction = rel === '.claude/CLAUDE.md' || rel.startsWith('.claude/rules/');
  return parts.every((p, i) => !!p && p !== '.' && p !== '..' && !SKIP.has(p) && (!p.startsWith('.') || (i === 0 && (['.agents', '.paradev'].includes(p) || (p === '.claude' && claudeInstruction)))));
}
/** Conventional project instructions can be gitignored. Never scan provider/account homes. */
export function localInstructions(root: string): string[] {
  const out = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.local.md', 'MEMORY.md', '.claude/CLAUDE.md', '.paradev/LEAD.md'];
  const walk = (rel: string, depth: number) => {
    if (depth > 6 || out.length >= 500) return;
    const dir = path.join(root, rel);
    try {
      const st = lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= 500) break;
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const next = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(next, depth + 1);
        else if (entry.isFile() && allowedSource(next)) out.push(next);
      }
    } catch { /* Missing conventional instruction folders are normal. */ }
  };
  // Reject an aliased .claude parent before walking its rules directory.
  try { if (lstatSync(path.join(root, '.claude')).isDirectory() && !lstatSync(path.join(root, '.claude')).isSymbolicLink()) walk('.claude/rules', 0); } catch { /* No project Claude rules. */ }
  walk('.agents', 0);
  return out.filter((rel) => { try { sourcePath(root, rel); return true; } catch { return false; } });
}
/** Reject aliases, even inside the checkout: an innocuous name must not reveal a private target. */
export function sourcePath(root: string, rel: string, missing = false): string {
  if (!allowedSource(rel)) throw new ContextError(400, 'Choose a project Markdown source; private, generated and provider-home files are excluded.');
  let current = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.nlink !== 1)) throw new ContextError(400, 'Links and non-regular sources are not editable context.');
      const real = realpathSync(current);
      if (!real.startsWith(root + path.sep)) throw new ContextError(400, 'The source is outside this project.');
    } catch (error) {
      if (missing && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return current;
      if (error instanceof ContextError) throw error;
      throw new ContextError(404, 'The source or its parent folder is missing. Reload before editing.');
    }
  }
  return current;
}
export function safeText(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_CONTEXT_BYTES || text.includes('\0')) throw new ContextError(413, 'Context files must be text, at most 256 KB.');
  if (/-----BEGIN [^-]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(text))
    throw new ContextError(400, 'This source appears to contain a credential. It cannot be opened or saved in this inspector.');
}
export function readSource(root: string, rel: string): { text: string | null; mode: number } {
  const file = sourcePath(root, rel, true);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: null, mode: 0o600 }; throw error; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_CONTEXT_BYTES) throw new ContextError(413, 'Not a regular context file of at most 256 KB.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd)); }
    catch { throw new ContextError(400, 'This source is not valid UTF-8. Its bytes were preserved.'); }
    safeText(text);
    return { text, mode: st.mode & 0o777 };
  } finally { closeSync(fd); }
}
