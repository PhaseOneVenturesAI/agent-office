import { realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HarnessJournal } from './history.js';
import { allowedHarnessSource, HarnessSourceError, harnessSourcePath, hashText, readHarnessSource, safeHarnessText } from './paths.js';
import type { HarnessChange, HarnessHistoryPage, HarnessSnapshot, HarnessSource } from './types.js';
export { HarnessSourceError, allowedHarnessSource } from './paths.js';
export type { HarnessChange, HarnessHistoryPage, HarnessRevision, HarnessSnapshot, HarnessSource } from './types.js';

/** Source editing only. Saving/restoring never Applies or changes any running agent. */
export class HarnessSources {
  readonly root: string;
  private journal: HarnessJournal;
  constructor(root: string, dataDir: string) {
    this.root = realpathSync(root);
    const data = realpathSync(dataDir);
    const storage = path.join(data, 'harness-history');
    if (storage === this.root || storage.startsWith(this.root + path.sep)) throw new HarnessSourceError(400, 'Harness history storage must be outside the shared Harness source.');
    this.journal = new HarnessJournal(data, this.root);
  }
  historicalPaths(): string[] { return this.journal.paths(); }
  read(rel: string): HarnessSource {
    let text: string | null;
    try { text = readHarnessSource(this.root, rel).text; }
    catch (error) {
      if (allowedHarnessSource(rel) && error instanceof HarnessSourceError) {
        const last = this.journal.ids(rel)[0];
        if (last) return { path: rel, text: null, revision: `unavailable:${last}`, status: 'unavailable' };
      }
      throw error;
    }
    const last = text === null ? this.journal.ids(rel)[0] : undefined;
    if (text === null && !last) throw new HarnessSourceError(404, 'This source is missing and has no retained history.');
    return { path: rel, text, revision: text === null ? `missing:${last}` : hashText(text), status: text === null ? 'missing' : 'present' };
  }
  revisions(rel: string, before?: string): HarnessHistoryPage {
    const ids = this.journal.ids(rel), start = before ? ids.indexOf(before) + 1 : 0;
    if (!ids.length) harnessSourcePath(this.root, rel);
    if (before && !start) throw new HarnessSourceError(409, 'Reload the Harness history list.');
    const page = ids.slice(start, start + 50);
    return { revisions: page.map((id) => {
      const { text, ...entry } = this.journal.get(rel, id);
      return { ...entry, hasText: text !== null, outcome: this.journal.outcome(rel, id) };
    }), ...(start + page.length < ids.length ? { next: page.at(-1) } : {}) };
  }
  snapshot(rel: string, id: string): HarnessSnapshot { return this.journal.get(rel, id); }
  /** Keep an existing one-deep backup unchanged; retain its content once before a new edit. */
  private retainLegacy(rel: string): void {
    const legacy = readHarnessSource(this.root, rel, true).text;
    if (legacy === null) return;
    const before = hashText(legacy);
    if (this.journal.ids(rel).some((id) => { const entry = this.journal.get(rel, id); return entry.action === 'legacy' && entry.before === before; })) return;
    this.journal.record({ id: this.journal.nextId(rel), path: rel, action: 'legacy', by: null, at: Date.now(), before, after: before, text: legacy });
  }
  private replace(from: string, to: string): void { renameSync(from, to); }
  change(ask: HarnessChange, by: string): { file: HarnessSource; warning?: string } {
    if (!ask || typeof ask.path !== 'string' || typeof ask.base !== 'string' || !ask.base) throw new HarnessSourceError(400, 'Reload the source and include its content revision before saving.');
    let current: HarnessSource;
    try { current = this.read(ask.path); }
    catch (error) { if (error instanceof HarnessSourceError && error.status === 404) throw new HarnessSourceError(409, 'This source was deleted or moved. Your draft was not applied.'); throw error; }
    if (current.revision !== ask.base) throw new HarnessSourceError(409, 'This source changed or was deleted since editing began. Your draft is kept; compare it with the current source before saving again.');
    let next: string;
    if (ask.action === 'edit') {
      if (current.text === null) throw new HarnessSourceError(409, 'This source is missing. Restore a historical revision explicitly.');
      if (typeof ask.text !== 'string') throw new HarnessSourceError(400, 'Missing Harness text.');
      next = ask.text;
    } else if (ask.action === 'restore') {
      const saved = this.snapshot(ask.path, ask.revision);
      if (saved.text === null) throw new HarnessSourceError(400, 'That revision has no source text to restore.');
      next = saved.text;
    } else throw new HarnessSourceError(400, 'Unknown Harness action.');
    safeHarnessText(next);
    if (next === current.text) throw new HarnessSourceError(400, 'No content change; nothing was saved.');
    const original = readHarnessSource(this.root, ask.path);
    if (original.text !== current.text) throw new HarnessSourceError(409, 'The source changed; reload it.');
    this.retainLegacy(ask.path);
    const id = this.journal.nextId(ask.path);
    const record: HarnessSnapshot = { id, path: ask.path, action: ask.action, by: by.slice(0, 100), at: Date.now(), before: current.revision, after: hashText(next), text: current.text,
      ...(ask.action === 'restore' ? { restoredFrom: ask.revision } : {}) };
    this.journal.record(record);
    let temporary: string | undefined;
    try {
      const target = harnessSourcePath(this.root, ask.path);
      temporary = path.join(path.dirname(target), `.office-harness-${id}.tmp`);
      writeFileSync(temporary, next, { flag: 'wx', mode: original.mode });
      if (readHarnessSource(this.root, ask.path).text !== current.text) throw new HarnessSourceError(409, 'The source changed while saving; your draft was not applied.');
      harnessSourcePath(this.root, ask.path);
      this.replace(temporary, target);
    } catch (error) {
      this.journal.receipt(ask.path, id, 'failed');
      if (error instanceof HarnessSourceError) throw error;
      throw new HarnessSourceError(500, 'The source was not changed. Its prior text is retained; check file permissions and storage.');
    } finally { if (temporary) { try { rmSync(temporary, { force: true }); } catch { /* Never the canonical source. */ } } }
    const recorded = this.journal.receipt(ask.path, id, 'applied');
    return { file: { path: ask.path, text: next, revision: record.after, status: 'present' }, ...(!recorded ? { warning: 'The source changed and its prior text is safe, but the completion receipt could not be written. History labels this attempt unconfirmed.' } : {}) };
  }
}
