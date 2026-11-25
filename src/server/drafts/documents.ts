import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DRAFT_LIMITS, type DraftBoards } from '../../shared/protocol/drafts.js';
import { cleanImage, type DesignImage } from './image-format.js';
export type ImageLookup = (hash: string) => DesignImage | undefined;
export type Documents = Record<string, string | Buffer>;

export function kickoffDocuments(name: string, boards: DraftBoards, image?: ImageLookup): Documents {
  const list = (lines: string[]) => lines.map(line => `- ${line}`).join('\n');
  const brand = boards.brand;
  const screens = [...boards.screens].sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
  const documents: Documents = {
    'README.md': `# ${name}\n\n${brand.tagline ?? ''}\n`,
    'docs/BRIEF.md': `# Decisions\n\n${list(boards.decisions)}\n\n## Ideas\n\n${boards.ideas.map(c => `### ${c.title}\n\n${c.note ?? ''}`).join('\n\n')}\n`,
    'docs/PLAN.md': `# Plan\n\n${list(boards.plan)}\n`,
    'docs/FEEDBACK.md': `# Board feedback\n\n${[...boards.ideas, ...boards.screens].map(c => `## ${c.title} (${c.id})\n\n${list(c.feedback.map(f => `${f.at}: ${f.text}`))}`).join('\n\n')}\n`,
    'design/system.md': `# Design system\n\nName: ${brand.name ?? name}\n\nTagline: ${brand.tagline ?? ''}\n\n## Colors\n\n${list(brand.colors)}\n`,
    'design/tokens.json': JSON.stringify({ name: brand.name ?? name, tagline: brand.tagline ?? '', colors: Object.fromEntries(brand.colors.map((color, i) => [`color${i + 1}`, color])) }, null, 2) + '\n',
  };
  documents['design/SCREENS.md'] = `# Screens\n\n${list(screens.map(s => {
    let link = '';
    const held = s.status === 'approved' && s.image && image?.(s.image.hash);
    if (held) {
      const checked = cleanImage(held.bytes);
      if (checked.meta.hash !== s.image!.hash || checked.meta.mime !== s.image!.mime || !checked.bytes.equals(held.bytes)) throw Error('Invalid kickoff image');
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[checked.meta.mime];
      if (!/^[\w-]{1,64}$/.test(s.id)) throw Error('Invalid screen id');
      const file = `screens/${s.id}.${ext}`;
      documents[`design/${file}`] = Buffer.from(held.bytes);
      link = ` — [Image](${file})`;
    }
    return `${s.title} — ${s.status}${link}${s.note ? ` — ${s.note}` : ''}`;
  }))}\n`;
  return documents;
}

function stat(file: string) {
  try { return lstatSync(file); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

/** Snapshot our explicit files and every parent, refusing aliases before any write. */
export function documentTransaction(dir: string, documents: Documents) {
  const names = Object.keys(documents);
  const fixed = new Set(['README.md', 'docs/BRIEF.md', 'docs/PLAN.md', 'docs/FEEDBACK.md', 'design/system.md', 'design/tokens.json', 'design/SCREENS.md']);
  for (const name of names) if (!fixed.has(name) && !/^design\/screens\/[\w-]{1,64}\.(png|jpg|webp)$/.test(name)) throw Error('Invalid document path');
  const folders = [...new Set(['', '.git', ...names.flatMap(name => {
    const parts = name.split('/'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  })])].sort((a, b) => a.split('/').length - b.split('/').length);
  const missing: string[] = [];
  for (const name of folders) {
    const folder = path.join(dir, name), s = stat(folder);
    if (s && (!s.isDirectory() || s.isSymbolicLink())) throw Error('Draft folder is not a regular directory');
    if (!s) missing.push(folder);
  }
  const files = [...names, '.git/index', '.git/config'].map(name => {
    const file = path.join(dir, name), s = stat(file);
    if (s && (!s.isFile() || s.nlink !== 1 || s.size > DRAFT_LIMITS.imageBytes)) throw Error('Draft file cannot be safely replaced');
    return { file, data: s ? readFileSync(file) : undefined, mode: s?.mode };
  });
  const created: string[] = [];
  return {
    write() {
      for (const folder of missing) { mkdirSync(folder); created.push(folder); }
      for (const [file, data] of Object.entries(documents)) writeFileSync(path.join(dir, file), data, { mode: 0o600 });
    },
    restore() {
      for (const f of files) {
        if (f.data !== undefined) { writeFileSync(f.file, f.data); chmodSync(f.file, f.mode!); }
        else rmSync(f.file, { force: true });
      }
      for (const folder of created.reverse()) rmdirSync(folder);
    },
  };
}
