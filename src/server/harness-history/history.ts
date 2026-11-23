import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { allowedHarnessSource, checkRoot, HarnessSourceError, hashText, safeHarnessText } from './paths.js';
import type { HarnessRevision, HarnessSnapshot } from './types.js';

const ID = /^\d{13}-[a-f0-9]{24}$/;
/** Immutable preimages and receipts, outside the Harness so Apply never distributes history. */
export class HarnessJournal {
  constructor(private dataDir: string, private root: string) {}
  private dir(rel?: string, create = false): string | undefined {
    checkRoot(this.dataDir);
    if (rel !== undefined && !allowedHarnessSource(rel)) throw new HarnessSourceError(400, 'Not a Harness source.');
    let dir = this.dataDir;
    for (const part of ['harness-history', hashText(this.root), ...(rel ? [hashText(rel)] : [])]) {
      dir = path.join(dir, part);
      try {
        const st = lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) throw new HarnessSourceError(400, 'Harness history storage must be a real directory.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (!create) return;
        mkdirSync(dir, { mode: 0o700 });
      }
    }
    return dir;
  }
  private read(file: string): string {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      // JSON may escape a text byte as six bytes (for example a control character).
      if (!st.isFile() || st.nlink !== 1 || st.size > 6 * 256_000 + 8192) throw new HarnessSourceError(400, 'Invalid Harness history file.');
      return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd));
    } finally { closeSync(fd); }
  }
  paths(): string[] {
    const dir = this.dir(); if (!dir) return [];
    return readdirSync(dir).filter((key) => /^[a-f0-9]{64}$/.test(key)).map((key) => {
      const folder = path.join(dir, key), st = lstatSync(folder);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new HarnessSourceError(400, 'Invalid Harness history directory.');
      const rel: unknown = JSON.parse(this.read(path.join(folder, 'source.json')));
      if (typeof rel !== 'string' || !allowedHarnessSource(rel) || hashText(rel) !== key) throw new HarnessSourceError(400, 'Invalid Harness history source.');
      return rel;
    });
  }
  ids(rel: string): string[] {
    const dir = this.dir(rel); if (!dir) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json') && ID.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort().reverse();
  }
  get(rel: string, id: string): HarnessSnapshot {
    if (!ID.test(id)) throw new HarnessSourceError(400, 'Invalid Harness revision.');
    const dir = this.dir(rel); if (!dir) throw new HarnessSourceError(404, 'No history for this Harness source.');
    let value: HarnessSnapshot;
    try { value = JSON.parse(this.read(path.join(dir, `${id}.json`))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HarnessSourceError(404, 'No such Harness revision.'); throw error; }
    if (!value || value.id !== id || value.path !== rel || !['edit', 'restore', 'legacy'].includes(value.action) || (value.text !== null && typeof value.text !== 'string') || (value.by !== null && typeof value.by !== 'string') || !Number.isFinite(value.at)) throw new HarnessSourceError(400, 'Invalid Harness history record.');
    if (value.text !== null) { safeHarnessText(value.text); if (hashText(value.text) !== value.before) throw new HarnessSourceError(400, 'Harness revision does not match its snapshot.'); }
    return value;
  }
  outcome(rel: string, id: string): HarnessRevision['outcome'] {
    if (this.get(rel, id).action === 'legacy') return 'retained';
    for (const status of ['applied', 'failed'] as const) {
      const file = path.join(this.dir(rel)!, `${id}.${status}`);
      // lstat through read rather than existsSync: broken receipt links must not look absent.
      try { if (this.read(file) !== status) throw new HarnessSourceError(400, 'Invalid history receipt.'); return status; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return 'unconfirmed';
  }
  record(snapshot: HarnessSnapshot): void {
    const dir = this.dir(snapshot.path, true)!;
    const source = path.join(dir, 'source.json');
    if (!existsSync(source)) writeFileSync(source, JSON.stringify(snapshot.path), { flag: 'wx', mode: 0o400 });
    else if (JSON.parse(this.read(source)) !== snapshot.path) throw new HarnessSourceError(400, 'History source mismatch.');
    writeFileSync(path.join(dir, `${snapshot.id}.json`), JSON.stringify(snapshot), { flag: 'wx', mode: 0o400 });
  }
  receipt(rel: string, id: string, outcome: 'applied' | 'failed'): boolean {
    try { writeFileSync(path.join(this.dir(rel)!, `${id}.${outcome}`), outcome, { flag: 'wx', mode: 0o400 }); return true; }
    catch { return false; }
  }
  nextId(rel: string): string { return `${Math.max(Date.now(), Number(this.ids(rel)[0]?.slice(0, 13) ?? 0) + 1)}-${randomBytes(12).toString('hex')}`; }
}
