// The office's harness: shared workflow defaults and skills, not project taste or review history.
// It is one folder on the office's machine (AGENT_OFFICE_HARNESS, or
// ~/Documents/AgentHarness when that's there, else <data dir>/harness). Admins read and edit its
// files from the office (☰ → 🧰 Harness), and Apply pushes them into the office's own and every
// account's agent homes (.agent-office/homes/<id>/): the same explicit shared instructions as
// CLAUDE.md for Claude and AGENTS.md for Kimi and Codex, plus skills/, so a change reaches everyone's
// agents without anyone opening a shell. An account with a .no-harness marker in its home is
// skipped: that person runs a harness of their own.
//
// Everything is jailed to the root: a path with `..`, an absolute path, a file over the size cap
// or an extension an agent never reads is turned away.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HarnessFile, HarnessState } from '../shared/protocol.js';
import { HarnessSources, allowedHarnessSource, type HarnessChange } from './harness-history/index.js';
import { harnessSourcePath, readHarnessSource } from './harness-history/paths.js';
import { composeHarness, HarnessSync } from './harness-sync.js';

/** The file kinds an agent's instructions and skills are made of. */
const EXTENSIONS = new Set(['.md', '.txt', '.json', '.toml', '.yaml', '.yml']);
/** A file bigger than this is not instructions: it isn't read or written through the office. */
const MAX_FILE = 256_000;
/** Bounds on the walk, so a harness with a stray checkout in it still answers promptly. */
const MAX_FILES = 500;
const MAX_DEPTH = 6;
export const ACCOUNT_ID = /^[A-Za-z0-9]{6,64}$/;
/** Only these files are global defaults. Other Markdown remains available to edit, not inject. */
const SHARED_INSTRUCTIONS = ['CLAUDE.md', 'WORKFLOW.md'];

/** The office machine's own agent homes: what Apply writes to first. */
export interface AgentHomes {
  claude: string;
  kimi: string;
  codex: string;
}

interface Applied {
  by: string;
  at: number;
  homes: number;
}

/** Where the harness lives when nothing says otherwise. */
export function harnessRoot(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENT_OFFICE_HARNESS) return env.AGENT_OFFICE_HARNESS;
  const documents = path.join(os.homedir(), 'Documents', 'AgentHarness');
  return existsSync(documents) ? documents : path.join(dataDir, 'harness');
}

export class Harness {
  private applied?: Applied;
  private readonly storeFile: string;

  constructor(
    private dataDir: string,
    /** The harness root (see harnessRoot). */
    readonly root: string,
    /** The office machine's own agent homes: what Apply writes to first. */
    private officeHomes: () => AgentHomes,
    private onChange: () => void,
  ) {
    this.storeFile = path.join(dataDir, 'harness.json');
    try {
      const saved = JSON.parse(readFileSync(this.storeFile, 'utf8')) as Applied;
      if (saved && typeof saved.by === 'string' && typeof saved.at === 'number') this.applied = saved;
    } catch {
      // nothing pushed yet
    }
  }

  state(): HarnessState {
    try {
      return { root: this.root, host: os.hostname(), files: this.list(), applied: this.applied };
    } catch (err) {
      return { root: this.root, files: [], applied: this.applied, error: (err as Error).message };
    }
  }

  /** The files someone may open, POSIX-pathed, sorted. */
  list(): HarnessFile[] {
    return existsSync(this.root) ? listHarnessFiles(this.sources()) : [];
  }

  sources(): HarnessSources { return new HarnessSources(this.root, this.dataDir); }

  /** Exact source text and content revision, never an implicit provider context. */
  read(rel: string): { text?: string | null; revision?: string; status?: 'present' | 'missing' | 'unavailable'; error?: string } {
    try { return this.sources().read(rel); }
    catch (error) { return { error: (error as Error).message }; }
  }

  change(ask: HarnessChange, by: string) {
    const result = this.sources().change(ask, by);
    this.onChange();
    return result;
  }

  /** Legacy internal call shape still fails closed when the content base is absent. */
  write(rel: string, text: string, base?: string): string | undefined {
    try { this.change({ path: rel, text, base: base ?? '', action: 'edit' }, 'Office admin'); return; }
    catch (error) { return (error as Error).message; }
  }

  /** Whether `id` runs a harness of their own: Apply skips their home. */
  optOut(id: string): boolean {
    return ACCOUNT_ID.test(id) && existsSync(path.join(this.dataDir, 'homes', id, '.no-harness'));
  }

  /** Marks `id` as running their own harness (or back on the office's). */
  setOptOut(id: string, out: boolean): string | undefined {
    if (!ACCOUNT_ID.test(id)) return 'Not an account';
    const marker = path.join(this.dataDir, 'homes', id, '.no-harness');
    try {
      if (out) {
        mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
        writeFileSync(marker, `Harness pushes skip this account. Delete this file to re-join.\n`, { mode: 0o600 });
      } else {
        rmSync(marker, { force: true });
      }
    } catch (err) {
      return `Couldn't change that: ${(err as Error).message}`;
    }
    return undefined;
  }

  /**
   * Pushes equivalent shared defaults and overlays shared skill files into the office's own and
   * every account's agent homes. Changed files get unique backups; unrelated files are retained.
   * Accounts that opted out are skipped. Retired unchanged managed outputs are backed up; local edits conflict.
   * Returns a line for the toast.
   */
  apply(by: string): string {
    const instructions = this.instructions();
    const sync = new HarnessSync(this.dataDir);
    const conflicts: string[] = [];
    let retired = 0;
    // One entry per home: Claude gets CLAUDE.md, Kimi and Codex get AGENTS.md; all get skills/.
    const targets: { dir: string; instructions: 'CLAUDE.md' | 'AGENTS.md' }[] = [];
    const office = this.officeHomes();
    targets.push({ dir: office.claude, instructions: 'CLAUDE.md' }, { dir: office.kimi, instructions: 'AGENTS.md' }, { dir: office.codex, instructions: 'AGENTS.md' });
    let accounts = 0;
    let skipped = 0;
    try {
      for (const entry of readdirSync(path.join(this.dataDir, 'homes'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !ACCOUNT_ID.test(entry.name)) continue;
        if (this.optOut(entry.name)) {
          skipped++;
          continue;
        }
        const home = path.join(this.dataDir, 'homes', entry.name);
        targets.push({ dir: path.join(home, 'claude'), instructions: 'CLAUDE.md' }, { dir: path.join(home, 'kimi'), instructions: 'AGENTS.md' }, { dir: path.join(home, 'codex'), instructions: 'AGENTS.md' });
        accounts++;
      }
    } catch {
      // no accounts yet: just the office's own
    }
    // Validate all sources before applying the first target. An unsafe source is not a deletion.
    const previews = targets.map((t) => sync.preview(t.dir, this.root, t.instructions, instructions));
    for (const [i, t] of targets.entries()) {
      const result = sync.apply(t.dir, this.root, t.instructions, instructions, previews[i]);
      conflicts.push(...result.conflicts); retired += result.retired;
    }
    this.applied = { by, at: Date.now(), homes: targets.length };
    try {
      writeFileSync(this.storeFile, JSON.stringify(this.applied), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the harness record: ${(err as Error).message}`);
    }
    this.onChange();
    const homes = accounts + 1;
    const note = skipped ? `, ${skipped} running their own` : '';
    const skippedNote = conflicts.length ? `; skipped ${conflicts.length} conflict(s), files preserved: ${[...new Set(conflicts)].slice(0, 3).join('; ')}` : '';
    return `pushed shared defaults to ${homes} agent home${homes === 1 ? '' : 's'} (Claude, Kimi and Codex${note}) — workers pick it up on their next start; changed files backed up, ${retired} retired managed file(s), unrelated files retained${skippedNote}`;
  }

  /** Identical defaults for every provider. Never inject project/taste/history files by glob. */
  private instructions(): string | undefined { return composeHarness(this.sources().root, SHARED_INSTRUCTIONS); }

}

/** The editable sources under a Harness root (jailed, bounded), plus paths only history still knows. */
export function listHarnessFiles(sources: HarnessSources): HarnessFile[] {
  const out: HarnessFile[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name)) || !allowedHarnessSource(relPath)) continue;
      try {
        const st = lstatSync(harnessSourcePath(sources.root, relPath));
        if (st.size <= MAX_FILE) out.push({ path: relPath, size: st.size, mtime: st.mtimeMs, status: 'present' });
      } catch { /* Unsafe/aliased sources are not exposed. */ }
    }
  };
  walk(sources.root, '', 0);
  for (const rel of sources.historicalPaths()) if (!out.some((file) => file.path === rel)) {
    const current = sources.read(rel);
    out.push({ path: rel, size: current.text === null ? 0 : Buffer.byteLength(current.text), mtime: 0, status: current.status });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
