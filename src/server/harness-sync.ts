// Applying a harness is a managed-file sync, not a mirror of the provider home. Only files this
// service previously wrote may be replaced/retired, and only while their hash still matches.
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { readHarnessSource } from './harness-history/paths.js';

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const validPath = (rel: string) => /^(?:CLAUDE\.md|AGENTS\.md|skills\/.+)$/.test(rel) && !rel.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) && !rel.includes('\\');
interface Entry { hash: string; source: string; sourceHash: string }
interface Contents { bytes: Buffer; mode: number }
interface Manifest { version: 1; target: string; files: Record<string, Entry> }
export interface HarnessPlan {
  target: string;
  source: string;
  sourceHash: string;
  changes: { path: string; action: 'write' | 'retire' | 'unchanged' | 'conflict'; before: string | null; after?: string; reason?: string }[];
}
export interface HarnessSyncResult { written: number; retired: number; conflicts: string[] }

/** Shared and personal instructions use the same legacy-policy exclusion; source text stays intact. */
export function composeHarness(root: string, names: string[]): string | undefined {
  const parts = new Set<string>();
  let found = false;
  for (const name of names) {
    const source = readHarnessSource(root, name).text;
    if (source === null) continue;
    found = true;
    const clean = source.replace(/\r\n?/g, '\n').replace(/<!-- review-ratchet:start -->[\s\S]*?<!-- review-ratchet:end -->/g, '').trim();
    if (clean.includes('<!-- review-ratchet:')) throw new Error(`Cannot push ${name}: incomplete legacy review block; preserve it separately before pushing`);
    if (clean) parts.add(clean);
  }
  return found ? (parts.size ? [...parts].join('\n\n') + '\n' : '') : undefined;
}

/** Reject incomplete/unsafe source trees before applying anything; never mistake a skipped path for deletion. */
function desiredFiles(root: string, instructions: string, text: string | undefined): Map<string, Contents> {
  const files = new Map<string, Contents>();
  if (text !== undefined) files.set(instructions, { bytes: Buffer.from(text), mode: 0o600 });
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > 12 || files.size > 5000) throw new Error('Harness skill tree is too large to apply safely');
    const st = lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Unsafe harness source: ${rel}`);
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name.endsWith('.bak')) continue;
      const name = `${rel}/${item.name}`, file = path.join(dir, item.name);
      if (!validPath(name)) throw new Error(`Unsafe harness source: ${name}`);
      const stat = lstatSync(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file, name, depth + 1);
      else {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error(`Unsafe harness source: ${name}`);
        files.set(name, { bytes: readFileSync(file), mode: stat.mode & 0o777 });
      }
    }
  };
  const skills = path.join(root, 'skills');
  // lstat also notices dangling links: an unreadable source must not retire installed content.
  let present = true;
  try { lstatSync(skills); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; present = false; }
  if (present) walk(skills, 'skills', 0);
  return files;
}

/** Validate each path component; never read/write through a linked destination. */
function destination(home: string, rel: string): string {
  if (!validPath(rel)) throw new Error('Invalid managed harness path');
  const parts = [home, ...rel.split('/')];
  let current = parts[0];
  for (let i = 0; i < parts.length; i++) {
    if (i) current = path.join(current, parts[i]);
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink() || (i === parts.length - 1 ? !st.isFile() || st.nlink !== 1 : !st.isDirectory())) throw new Error('symlink, hardlink or non-file destination');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return current;
}
function currentHash(home: string, rel: string): string | null {
  const file = destination(home, rel);
  try { return hash(readFileSync(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export class HarnessSync {
  constructor(private dataDir: string) {}
  private manifestPath(target: string, create = false): string {
    const dir = path.join(this.dataDir, 'harness-managed');
    if (create && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (existsSync(dir) && (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())) throw new Error('Unsafe harness manifest directory');
    return path.join(dir, hash(path.resolve(target)) + '.json');
  }
  private load(target: string): Manifest {
    const file = this.manifestPath(target);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('Unsafe harness manifest');
      const m = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
      if (m.version !== 1 || m.target !== path.resolve(target) || !m.files || Array.isArray(m.files) || typeof m.files !== 'object') throw new Error('Invalid harness manifest');
      for (const [rel, e] of Object.entries(m.files)) if (!validPath(rel) || !e || !/^[a-f0-9]{64}$/.test(e.hash) || typeof e.source !== 'string' || !/^[a-f0-9]{64}$/.test(e.sourceHash)) throw new Error('Invalid harness manifest entry');
      return m;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, target: path.resolve(target), files: {} };
      throw error;
    }
  }
  /** Does not write files, create folders or adopt existing unmanaged files. */
  preview(target: string, source: string, instructions: string, text: string | undefined): HarnessPlan {
    const desired = desiredFiles(source, instructions, text), previous = this.load(target);
    const sourceHash = hash(JSON.stringify([...desired].map(([rel, content]) => [rel, hash(content.bytes), content.mode]).sort()));
    const changes: HarnessPlan['changes'] = [];
    for (const rel of new Set([...desired.keys(), ...Object.keys(previous.files)])) {
      const after = desired.has(rel) ? hash(desired.get(rel)!.bytes) : undefined;
      try {
        const before = currentHash(target, rel), known = previous.files[rel];
        const reason = before !== null && !known ? 'untracked file; review it before adopting' : before !== null && before !== known?.hash ? 'locally edited since last apply' : undefined;
        changes.push({ path: rel, before, after, action: reason ? 'conflict' : after === undefined ? 'retire' : before === after ? 'unchanged' : 'write', ...(reason ? { reason } : {}) });
      } catch (error) { changes.push({ path: rel, before: null, after, action: 'conflict', reason: (error as Error).message }); }
    }
    return { target: path.resolve(target), source: path.resolve(source), sourceHash, changes };
  }
  /** Rechecks a supplied preview and each destination; changes after preview fail closed. */
  apply(target: string, source: string, instructions: string, text: string | undefined, expected?: HarnessPlan): HarnessSyncResult {
    const plan = this.preview(target, source, instructions, text);
    if (expected && JSON.stringify(expected) !== JSON.stringify(plan)) throw new Error('Harness changed since preview; preview it again before applying');
    const desired = desiredFiles(source, instructions, text), manifest = this.load(target);
    if (plan.sourceHash !== hash(JSON.stringify([...desired].map(([rel, content]) => [rel, hash(content.bytes), content.mode]).sort()))) throw new Error('Harness source changed during apply; preview it again');
    const result: HarnessSyncResult = { written: 0, retired: 0, conflicts: [] };
    const suffix = `.harness-${Date.now()}-${randomBytes(6).toString('hex')}.bak`;
    for (const change of plan.changes) {
      if (change.action === 'conflict') { result.conflicts.push(`${change.path}: ${change.reason}`); continue; }
      if (currentHash(target, change.path) !== change.before) { result.conflicts.push(`${change.path}: changed during apply`); continue; }
      const file = destination(target, change.path);
      if (change.action === 'retire') {
        if (change.before !== null) { renameSync(file, file + suffix); result.retired++; }
        delete manifest.files[change.path];
        continue;
      }
      if (change.action === 'write') {
        mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        destination(target, change.path);
        if (change.before !== null) copyFileSync(file, file + suffix, constants.COPYFILE_EXCL);
        const temp = file + `.harness-${randomBytes(6).toString('hex')}.tmp`;
        try {
          const content = desired.get(change.path)!;
          const mode = change.before === null ? content.mode : lstatSync(file).mode & 0o777;
          writeFileSync(temp, content.bytes, { flag: 'wx', mode });
          chmodSync(temp, mode); // File creation applies umask; preserve the explicitly selected source/local mode.
          renameSync(temp, file);
        }
        finally { rmSync(temp, { force: true }); }
        result.written++;
      }
      manifest.files[change.path] = { hash: change.after!, source: plan.source, sourceHash: plan.sourceHash };
    }
    const receipt = this.manifestPath(target, true), temp = receipt + `.${randomBytes(6).toString('hex')}.tmp`;
    try { writeFileSync(temp, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 }); renameSync(temp, receipt); }
    finally { rmSync(temp, { force: true }); }
    return result;
  }
}
