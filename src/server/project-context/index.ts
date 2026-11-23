import { lstatSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContextFile, ContextHistory, ContextMutation, ContextSource } from '../../shared/protocol/project-context.js';
import { allowedSource, ContextError, hashText, localInstructions, readSource, safeText, sourcePath } from './paths.js';
import { ContextHistoryStore, type Snapshot } from './history.js';
export { ContextError } from './paths.js';

/** Canonical project Markdown is authoritative. This journal stores prior revisions, never a task backlog. */
export class ProjectContext {
  private root: string;
  private history: ContextHistoryStore;
  constructor(projectDir: string) { this.root = realpathSync(projectDir); this.history = new ContextHistoryStore(this.root); }
  list(discovered: string[]): ContextSource[] {
    const known = new Set(this.history.paths());
    return [...new Set([...discovered, ...localInstructions(this.root), ...known])].flatMap((rel): ContextSource[] => {
      try {
        const file = sourcePath(this.root, rel, true);
        try { return [{ path: rel, present: true, size: lstatSync(file).size }]; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [{ path: rel, present: false }]; throw error; }
      } catch { return known.has(rel) ? [{ path: rel, present: false, unavailable: true }] : []; }
    }).sort((a, b) => a.path.localeCompare(b.path));
  }
  read(rel: string): ContextFile {
    let text: string | null;
    try { text = readSource(this.root, rel).text; }
    catch (error) {
      if (allowedSource(rel) && error instanceof ContextError) {
        const last = this.history.ids(rel)[0];
        if (last) return { path: rel, text: null, revision: `unavailable:${last}`, status: 'unavailable' };
      }
      throw error;
    }
    const last = text === null ? this.history.ids(rel)[0] : undefined;
    if (text === null && !last) throw new ContextError(404, 'This source is missing and has no recorded history here.');
    return { path: rel, text, revision: text === null ? `missing:${last}` : hashText(text), status: text === null ? 'missing' : 'present' };
  }
  revisions(rel: string, before?: string): ContextHistory {
    if (!allowedSource(rel)) throw new ContextError(400, 'Not a project context source.');
    const ids = this.history.ids(rel), start = before ? ids.indexOf(before) + 1 : 0;
    if (!ids.length) sourcePath(this.root, rel, true);
    if (before && !start) throw new ContextError(409, 'History changed; reload the revision list.');
    const page = ids.slice(start, start + 50);
    return { revisions: page.map((id) => {
      const { text, ...entry } = this.history.get(rel, id);
      return { ...entry, hasText: text !== null, outcome: this.history.outcome(rel, id) };
    }), ...(start + page.length < ids.length ? { next: page.at(-1) } : {}) };
  }
  snapshot(rel: string, id: string): Snapshot {
    if (!allowedSource(rel)) throw new ContextError(400, 'Not a project context source.');
    return this.history.get(rel, id);
  }
  private replace(from: string, to: string): void { renameSync(from, to); }
  mutate(ask: ContextMutation, by: string): { file: ContextFile; warning?: string } {
    if (!ask || typeof ask.path !== 'string' || typeof ask.base !== 'string' || typeof ask.reason !== 'string' || !ask.reason.trim() || ask.reason.length > 1000) throw new ContextError(400, 'Choose a source and include its revision and a short reason.');
    let current: ContextFile;
    try { current = this.read(ask.path); }
    catch (error) { if (error instanceof ContextError && error.status === 404) throw new ContextError(409, 'This source was deleted or moved. Your draft was not applied; reload before continuing.'); throw error; }
    if (current.revision !== ask.base) throw new ContextError(409, 'This source changed or was deleted since you opened it. Your draft is kept; reload the source before deciding what to save.');
    let next: string | null;
    if (ask.action === 'edit') {
      if (current.text === null) throw new ContextError(409, 'This source is missing. Restore a historical revision explicitly.');
      if (typeof ask.text !== 'string') throw new ContextError(400, 'Missing Markdown text.');
      next = ask.text;
    } else if (ask.action === 'restore') {
      const saved = this.snapshot(ask.path, ask.revision ?? '');
      if (saved.text === null) throw new ContextError(400, 'That revision has no file text to restore.');
      next = saved.text;
    } else if (ask.action === 'archive' || ask.action === 'supersede') {
      if (current.text === null) throw new ContextError(409, 'This source is already missing.');
      if (ask.action === 'supersede') {
        if (!ask.replacement || ask.replacement === ask.path || this.read(ask.replacement).text === null) throw new ContextError(400, 'Choose a different existing project Markdown source as its replacement.');
      }
      next = null;
    } else throw new ContextError(400, 'Unknown context action.');
    if (next !== null) safeText(next);
    if (next === current.text) throw new ContextError(400, 'No content change; nothing was saved.');
    const original = readSource(this.root, ask.path), id = this.history.nextId(ask.path);
    if (original.text !== current.text) throw new ContextError(409, 'The source changed; reload it.');
    const record: Snapshot = { id, path: ask.path, action: ask.action, by: by.slice(0, 100), at: Date.now(), reason: ask.reason.trim(), before: current.revision, after: next === null ? `missing:${id}` : hashText(next), text: current.text,
      ...(ask.action === 'supersede' ? { supersededBy: ask.replacement } : {}), ...(ask.action === 'restore' ? { restoredFrom: ask.revision } : {}) };
    // Journal must be written before replacing or removing the canonical file. Failed attempts
    // remain visible; an absent receipt means interrupted/unconfirmed, never asserted successful.
    this.history.record(record);
    let temporary: string | undefined;
    try {
      const target = sourcePath(this.root, ask.path, true);
      if (next !== null) {
        temporary = path.join(path.dirname(target), `.office-context-${id}.tmp`);
        writeFileSync(temporary, next, { flag: 'wx', mode: original.mode });
      }
      if (readSource(this.root, ask.path).text !== current.text) throw new ContextError(409, 'The source changed while saving; your draft was not applied.');
      sourcePath(this.root, ask.path, true);
      if (next === null) unlinkSync(target); else this.replace(temporary!, target);
    } catch (error) {
      this.history.receipt(ask.path, id, 'failed');
      if (error instanceof ContextError) throw error;
      throw new ContextError(500, 'The source was not changed. Its prior revision is kept; check project file permissions and storage.');
    } finally { if (temporary) { try { rmSync(temporary, { force: true }); } catch { /* A hidden temp may remain; it is not the canonical source. */ } } }
    const recorded = this.history.receipt(ask.path, id, 'applied');
    return { file: { path: ask.path, text: next, revision: record.after, status: next === null ? 'missing' : 'present' }, ...(!recorded ? { warning: 'The file changed and its prior snapshot is safe, but the completion receipt could not be written. History labels this attempt unconfirmed.' } : {}) };
  }
}
