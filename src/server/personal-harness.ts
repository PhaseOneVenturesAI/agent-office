// Each account's own harness: instructions and skills a person keeps for their own agents, instead
// of the office's shared one (server/harness.ts). It lives in their home on the office's machine,
// .agent-office/homes/<id>/harness/, beside the agent homes it is applied to ({claude,kimi,codex}).
//
// Choosing it is the same .no-harness marker "Run my own instead" in 🔐 Your sign-ins drops, so the
// office's push skips that person's agent homes. Nothing here ever takes an account id from a
// browser: the handlers pass the id of the signed-in connection, so nobody reaches another
// account's files. The shared harness's jail (extensions, 256 KB, no `..`, no links, no
// credentials) and its content-hash stale-save check and retained history apply unchanged: a
// personal root is just another HarnessSources root, with its history kept under its own hash.

import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { PersonalHarnessState } from '../shared/protocol/personal-harness.js';
import { ACCOUNT_ID, listHarnessFiles, pushDirectory, pushFile, pushSkills, type Harness } from './harness.js';
import { HarnessSourceError, HarnessSources, allowedHarnessSource, type HarnessChange, type HarnessSource } from './harness-history/index.js';
import { harnessSourcePath, readHarnessSource, safeHarnessText } from './harness-history/paths.js';

/** The files a personal harness starts from when copied from the office's. */
const SEED = /^(?:CLAUDE\.md|WORKFLOW\.md|AGENTS\.md|skills\/.+)$/;

/** Which personal files make each provider's instructions, in order (duplicates dropped). */
const CLAUDE_SOURCES = ['CLAUDE.md', 'WORKFLOW.md'];
const AGENTS_SOURCES = ['AGENTS.md', 'WORKFLOW.md'];

interface Applied { at: number; homes: number }

export class PersonalHarness {
  constructor(private dataDir: string, private shared: Harness) {}

  /** Whether `id` is on their own harness (the office's push skips them). */
  own(id: string): boolean { return this.shared.optOut(id); }

  /** Use your own harness (true) or the office's (false): the same marker the sign-ins toggle sets. */
  setOwn(id: string, own: boolean): string | undefined { return this.shared.setOptOut(id, own); }

  state(id: string): PersonalHarnessState {
    const mode = this.own(id) ? 'own' : 'office';
    const root = this.rootOf(id);
    try {
      const sources = this.sources(id);
      return { mode, root, files: sources ? listHarnessFiles(sources) : [], applied: this.applied(id) };
    } catch (error) {
      return { mode, root, files: [], applied: this.applied(id), error: (error as Error).message };
    }
  }

  read(id: string, rel: string): HarnessSource {
    const sources = this.sources(id);
    if (!sources) throw new HarnessSourceError(404, 'Your harness has no files yet.');
    return sources.read(rel);
  }

  change(id: string, ask: HarnessChange, by: string) {
    const sources = this.sources(id);
    if (!sources) throw new HarnessSourceError(404, 'Your harness has no files yet.');
    return sources.change(ask, by);
  }

  /** The retained history of one of your files. */
  history(id: string): HarnessSources {
    const sources = this.sources(id);
    if (!sources) throw new HarnessSourceError(404, 'Your harness has no files yet.');
    return sources;
  }

  /** A new file in your harness; never over one that is there or that history still holds. */
  create(id: string, rel: string, text: string): HarnessSource {
    if (!allowedHarnessSource(rel)) throw new HarnessSourceError(400, 'Choose a supported file name (.md, .txt, .json, .toml, .yaml), with no hidden or private folders.');
    safeHarnessText(text);
    const sources = this.sources(id, true)!;
    try {
      sources.read(rel);
      throw new HarnessSourceError(409, 'That file is already in your harness (or in its history). Open it from the list instead.');
    } catch (error) {
      if (!(error instanceof HarnessSourceError) || error.status !== 404) throw error;
    }
    const parts = rel.split('/');
    let dir = sources.root;
    for (const part of parts.slice(0, -1)) {
      dir = path.join(dir, part);
      realDirectory(dir, true);
    }
    writeFileSync(harnessSourcePath(sources.root, rel), text, { flag: 'wx', mode: 0o600 });
    return sources.read(rel);
  }

  /**
   * Copies the office's CLAUDE.md, WORKFLOW.md, AGENTS.md and skills/ into your harness as a
   * starting point. A file you already have is left alone.
   */
  seed(id: string): string {
    const shared = this.shared.sources();
    let copied = 0, kept = 0, skipped = 0;
    for (const file of listHarnessFiles(shared)) {
      if (file.status !== 'present' || !SEED.test(file.path)) continue;
      let text: string | null;
      try { text = readHarnessSource(shared.root, file.path).text; } catch { skipped++; continue; }
      if (text === null) continue;
      try { this.create(id, file.path, text); copied++; }
      catch (error) { if (error instanceof HarnessSourceError && error.status === 409) kept++; else skipped++; }
    }
    const notes = [kept ? `kept ${kept} of yours` : '', skipped ? `skipped ${skipped} unreadable` : ''].filter(Boolean).join(', ');
    return `copied ${copied} file${copied === 1 ? '' : 's'} from the office’s harness${notes ? ` (${notes})` : ''}`;
  }

  /**
   * Pushes your harness into your own agent homes only: Claude gets CLAUDE.md (+ WORKFLOW.md) and
   * skills/, Kimi and Codex get AGENTS.md (or CLAUDE.md when you have none, + WORKFLOW.md) and skills/.
   * Changed files are backed up first; files you didn't write here are left alone.
   */
  apply(id: string): string {
    if (!this.own(id)) throw new HarnessSourceError(409, 'Choose “Use my own harness” first, or the office’s next push would replace it.');
    const sources = this.sources(id);
    if (!sources) throw new HarnessSourceError(404, 'Your harness has no files yet. Add one, or start from the office’s.');
    const home = this.homeOf(id);
    const claude = compose(sources.root, CLAUDE_SOURCES);
    const agents = compose(sources.root, readHarnessSource(sources.root, 'AGENTS.md').text === null ? CLAUDE_SOURCES : AGENTS_SOURCES);
    const skills = path.join(sources.root, 'skills');
    const backup = `.harness-${Date.now()}-${randomBytes(4).toString('hex')}.bak`;
    let skippedFiles = 0;
    const targets = [
      { dir: path.join(home, 'claude'), name: 'CLAUDE.md', text: claude },
      { dir: path.join(home, 'kimi'), name: 'AGENTS.md', text: agents },
      { dir: path.join(home, 'codex'), name: 'AGENTS.md', text: agents },
    ];
    let hasSkills = false;
    try { hasSkills = realDirectory(skills, false); } catch { skippedFiles++; }
    for (const t of targets) {
      if (!pushDirectory(t.dir)) { skippedFiles++; continue; }
      if (t.text !== undefined && !pushFile(path.join(t.dir, t.name), Buffer.from(t.text), backup)) skippedFiles++;
      if (hasSkills) skippedFiles += pushSkills(skills, path.join(t.dir, 'skills'), backup);
    }
    const applied: Applied = { at: Date.now(), homes: targets.length };
    try { writeFileSync(path.join(home, '.harness-applied.json'), JSON.stringify(applied), { mode: 0o600 }); } catch { /* only the note on the panel */ }
    const skippedNote = skippedFiles ? `; skipped ${skippedFiles} link or non-file path(s)` : '';
    return `applied your harness to your Claude, Kimi and Codex — your workers pick it up on their next start; changed files backed up${skippedNote}`;
  }

  private homeOf(id: string): string {
    if (!ACCOUNT_ID.test(id)) throw new HarnessSourceError(403, 'Only signed-in accounts have a harness of their own.');
    return path.join(this.dataDir, 'homes', id);
  }

  private rootOf(id: string): string { return path.join(this.homeOf(id), 'harness'); }

  /** The account's sources; undefined when it has none yet (made when `create` is true). */
  private sources(id: string, create = false): HarnessSources | undefined {
    const home = this.homeOf(id);
    // Every step from the data dir down must be a real folder, never a link to someone else's.
    for (const dir of [path.join(this.dataDir, 'homes'), home, this.rootOf(id)]) if (!realDirectory(dir, create)) return undefined;
    return new HarnessSources(this.rootOf(id), this.dataDir);
  }

  private applied(id: string): Applied | undefined {
    try {
      const saved = JSON.parse(readFileSync(path.join(this.homeOf(id), '.harness-applied.json'), 'utf8')) as Applied;
      return typeof saved?.at === 'number' && typeof saved.homes === 'number' ? saved : undefined;
    } catch { return undefined; }
  }
}

/** Whether `dir` is a real directory (made when missing and `create`); a link or file throws. */
function realDirectory(dir: string, create: boolean): boolean {
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new HarnessSourceError(400, 'Your harness folder must be a real folder, not a link.');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return false;
    mkdirSync(dir, { mode: 0o700 });
    return true;
  }
}

/** The named files' text joined, duplicates dropped; undefined when none of them is there. */
function compose(root: string, names: string[]): string | undefined {
  const parts: string[] = [];
  let found = false;
  for (const name of names) {
    const text = readHarnessSource(root, name).text;
    if (text === null) continue;
    found = true;
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (clean && !parts.includes(clean)) parts.push(clean);
  }
  return found ? (parts.length ? `${parts.join('\n\n')}\n` : '') : undefined;
}
