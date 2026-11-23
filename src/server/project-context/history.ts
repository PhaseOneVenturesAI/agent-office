import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ContextRevision } from '../../shared/protocol/project-context.js';
import { allowedSource, ContextError, hashText, safeText } from './paths.js';

export type Snapshot = Omit<ContextRevision, 'outcome' | 'hasText'> & { text: string | null };
const ID = /^\d{13}-[a-f0-9]{24}$/;
/** Immutable preimages plus separate operation receipts. No history is pruned. */
export class ContextHistoryStore {
  constructor(private root: string) {}
  private dir(rel?: string, create = false): string | undefined {
    let dir = this.root;
    for (const part of ['.agent-office', 'project-context', ...(rel ? [hashText(rel)] : [])]) {
      dir = path.join(dir, part);
      if (!existsSync(dir)) { if (!create) return; mkdirSync(dir, { mode: 0o700 }); }
      const st = lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new ContextError(400, 'Project context history storage is not a real project directory.');
    }
    return dir;
  }
  private read(file: string): string {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > 2 * 256 * 1024) throw new ContextError(400, 'Invalid context history file.');
      return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd));
    } finally { closeSync(fd); }
  }
  paths(): string[] {
    const dir = this.dir(); if (!dir) return [];
    return readdirSync(dir).filter((key) => /^[a-f0-9]{64}$/.test(key)).map((key) => {
      const folder = path.join(dir, key), st = lstatSync(folder);
      if (!st.isDirectory() || st.isSymbolicLink()) throw new ContextError(400, 'Invalid context history directory.');
      const rel: unknown = JSON.parse(this.read(path.join(folder, 'source.json')));
      if (typeof rel !== 'string' || !allowedSource(rel) || hashText(rel) !== key) throw new ContextError(400, 'Invalid context history source.');
      return rel;
    });
  }
  ids(rel: string): string[] {
    const dir = this.dir(rel); if (!dir) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json') && ID.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort().reverse();
  }
  get(rel: string, id: string): Snapshot {
    if (!ID.test(id)) throw new ContextError(400, 'Invalid revision.');
    const dir = this.dir(rel); if (!dir) throw new ContextError(404, 'No history for this source.');
    let value: Snapshot;
    try { value = JSON.parse(this.read(path.join(dir, `${id}.json`))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ContextError(404, 'No such revision in this project source.'); throw error; }
    if (value.id !== id || value.path !== rel || !['edit', 'archive', 'supersede', 'restore'].includes(value.action) || (value.text !== null && typeof value.text !== 'string')) throw new ContextError(400, 'Invalid context history record.');
    if (value.text !== null) { safeText(value.text); if (hashText(value.text) !== value.before) throw new ContextError(400, 'Context history revision does not match its snapshot.'); }
    return value;
  }
  outcome(rel: string, id: string): ContextRevision['outcome'] {
    const dir = this.dir(rel)!;
    for (const status of ['applied', 'failed'] as const) {
      const file = path.join(dir, `${id}.${status}`);
      if (existsSync(file)) { if (this.read(file) !== status) throw new ContextError(400, 'Invalid history receipt.'); return status; }
    }
    return 'unconfirmed';
  }
  record(snapshot: Snapshot): void {
    const dir = this.dir(snapshot.path, true)!;
    const source = path.join(dir, 'source.json');
    if (!existsSync(source)) writeFileSync(source, JSON.stringify(snapshot.path), { flag: 'wx', mode: 0o400 });
    else if (JSON.parse(this.read(source)) !== snapshot.path) throw new ContextError(400, 'History source mismatch.');
    writeFileSync(path.join(dir, `${snapshot.id}.json`), JSON.stringify(snapshot), { flag: 'wx', mode: 0o400 });
  }
  receipt(rel: string, id: string, outcome: 'applied' | 'failed'): boolean {
    try { writeFileSync(path.join(this.dir(rel)!, `${id}.${outcome}`), outcome, { flag: 'wx', mode: 0o400 }); return true; }
    catch { return false; }
  }
  nextId(rel: string): string { return `${Math.max(Date.now(), Number(this.ids(rel)[0]?.slice(0, 13) ?? 0) + 1)}-${randomBytes(12).toString('hex')}`; }
}
