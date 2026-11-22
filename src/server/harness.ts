// The office's harness: the instruction and skill files every worker runs with — the taste lock,
// the workflow, the skills. It is one folder on the office's machine (AGENT_OFFICE_HARNESS, or
// ~/Documents/AgentHarness when that's there, else <data dir>/harness). Admins read and edit its
// files from the office (☰ → 🧰 Harness), and Apply pushes CLAUDE.md and skills/ into the office's
// own and every account's Claude home (.agent-office/homes/<id>/claude), so a change reaches
// everyone's agents without anyone opening a shell.
//
// Everything is jailed to the root: a path with `..`, an absolute path, a file over the size cap
// or an extension an agent never reads is turned away.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HarnessFile, HarnessState } from '../shared/protocol.js';

/** The file kinds an agent's instructions and skills are made of. */
const EXTENSIONS = new Set(['.md', '.txt', '.json', '.toml', '.yaml', '.yml']);
/** A file bigger than this is not instructions: it isn't read or written through the office. */
const MAX_FILE = 256_000;
/** Bounds on the walk, so a harness with a stray checkout in it still answers promptly. */
const MAX_FILES = 500;
const MAX_DEPTH = 6;
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w .@+\-/]+$/;

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
    /** The office machine's own Claude home: what Apply writes to first. */
    private officeClaudeDir: () => string,
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
      return { root: this.root, files: this.list(), applied: this.applied };
    } catch (err) {
      return { root: this.root, files: [], applied: this.applied, error: (err as Error).message };
    }
  }

  /** The files someone may open, POSIX-pathed, sorted. */
  list(): HarnessFile[] {
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
        if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name)) || entry.name.endsWith('.bak')) continue;
        const st = statSync(full);
        if (st.size <= MAX_FILE) out.push({ path: relPath, size: st.size, mtime: st.mtimeMs });
      }
    };
    if (!existsSync(this.root)) return [];
    walk(this.root, '', 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** One file's text, or why not. */
  read(rel: string): { text?: string; error?: string } {
    const file = this.jail(rel);
    if (typeof file !== 'string') return { error: file.error };
    try {
      const st = statSync(file);
      if (st.size > MAX_FILE) return { error: `That file is ${Math.ceil(st.size / 1024)} KB — too big to edit here` };
      return { text: readFileSync(file, 'utf8') };
    } catch {
      return { error: 'No such file' };
    }
  }

  /** Replaces one file's text, keeping what it was as <file>.bak. Returns why it didn't. */
  write(rel: string, text: string): string | undefined {
    const file = this.jail(rel);
    if (typeof file !== 'string') return file.error;
    if (text.length > MAX_FILE) return `That is over ${Math.ceil(MAX_FILE / 1024)} KB — too big for an instructions file`;
    try {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (existsSync(file)) cpSync(file, `${file}.bak`);
      writeFileSync(file, text, { mode: 0o600 });
    } catch (err) {
      return `Couldn't write ${rel}: ${(err as Error).message}`;
    }
    this.onChange();
    return undefined;
  }

  /**
   * Pushes CLAUDE.md and skills/ into the office's own Claude home and every account's
   * (.agent-office/homes/<id>/claude), so every worker — whoever hired it — runs with them.
   * Returns a line for the toast.
   */
  apply(by: string): string {
    const claudeMd = path.join(this.root, 'CLAUDE.md');
    const skills = path.join(this.root, 'skills');
    const targets = [this.officeClaudeDir()];
    let homes = 0;
    try {
      for (const entry of readdirSync(path.join(this.dataDir, 'homes'), { withFileTypes: true })) {
        if (entry.isDirectory()) targets.push(path.join(this.dataDir, 'homes', entry.name, 'claude'));
      }
    } catch {
      // no accounts yet: just the office's own
    }
    for (const target of targets) {
      mkdirSync(target, { recursive: true, mode: 0o700 });
      if (existsSync(claudeMd)) cpSync(claudeMd, path.join(target, 'CLAUDE.md'));
      if (existsSync(skills)) {
        const into = path.join(target, 'skills');
        rmSync(into, { recursive: true, force: true });
        cpSync(skills, into, { recursive: true });
      }
      homes++;
    }
    this.applied = { by, at: Date.now(), homes };
    try {
      writeFileSync(this.storeFile, JSON.stringify(this.applied), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the harness record: ${(err as Error).message}`);
    }
    this.onChange();
    return `pushed CLAUDE.md and skills to ${homes} agent home${homes === 1 ? '' : 's'} — workers pick it up on their next start`;
  }

  /** `rel` resolved inside the root, or the reason it isn't allowed. */
  private jail(rel: string): string | { error: string } {
    if (!rel || rel.length > 300 || !REL_PATH.test(rel)) return { error: 'Not a path in the harness' };
    if (!EXTENSIONS.has(path.extname(rel)) || rel.endsWith('.bak')) return { error: 'Only instructions files (.md, .txt, .json, .toml, .yaml) can be edited here' };
    const file = path.join(this.root, rel);
    return path.resolve(file).startsWith(path.resolve(this.root) + path.sep) ? file : { error: 'Not a path in the harness' };
  }
}
