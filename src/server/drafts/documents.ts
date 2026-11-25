import { lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DraftBoards } from '../../shared/protocol/drafts.js';

export function kickoffDocuments(name: string, boards: DraftBoards): Record<string, string> {
  const list = (lines: string[]) => lines.map(line => `- ${line}`).join('\n');
  const brand = boards.brand;
  const screens = [...boards.screens].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
  // Content is already bounded single-line text. It never becomes an argument, a path or a template.
  return {
    'README.md': `# ${name}\n\n${brand.tagline ?? ''}\n`,
    'docs/BRIEF.md': `# Decisions\n\n${list(boards.decisions)}\n`,
    'docs/PLAN.md': `# Plan\n\n${list(boards.plan)}\n`,
    'docs/SCREENS.md': `# Screens\n\n${list(screens.map(s => `${s.title} — ${s.status}`))}\n`,
    'docs/BRAND.md': `# Brand\n\nName: ${brand.name ?? name}\n\nTagline: ${brand.tagline ?? ''}\n\n## Colors\n\n${list(brand.colors)}\n`,
  };
}

function stat(file: string) {
  try { return lstatSync(file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

/** Snapshot only our fixed files. Refuse aliases rather than writing outside the draft checkout. */
export function documentTransaction(dir: string, documents: Record<string, string>) {
  for (const folder of [dir, path.join(dir, '.git'), path.join(dir, 'docs')]) {
    const s = stat(folder);
    if (s && (!s.isDirectory() || s.isSymbolicLink())) throw Error('Draft folder is not a regular directory');
  }
  const hadDocs = !!stat(path.join(dir, 'docs'));
  const files = [...Object.keys(documents), '.git/index', '.git/config'].map(name => {
    const file = path.join(dir, name), s = stat(file);
    if (s && (!s.isFile() || s.nlink !== 1 || s.size > 1024 * 1024)) throw Error('Draft file cannot be safely replaced');
    return { file, data: s ? readFileSync(file) : undefined, mode: s?.mode };
  });
  return {
    write() {
      mkdirSync(path.join(dir, 'docs'), { recursive: true });
      for (const [file, text] of Object.entries(documents)) writeFileSync(path.join(dir, file), text, { mode: 0o600 });
    },
    restore() {
      for (const f of files) {
        if (f.data !== undefined) writeFileSync(f.file, f.data, { mode: f.mode });
        else rmSync(f.file, { force: true });
      }
      if (!hadDocs) rmdirSync(path.join(dir, 'docs'));
    },
  };
}
