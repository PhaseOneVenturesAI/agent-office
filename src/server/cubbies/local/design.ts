import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { DRAFT_LIMITS } from '../../../shared/protocol/drafts.js';
import { cleanDraftBoards } from '../../drafts/boards.js';
import { cleanImage, type DesignImage } from '../../drafts/image-format.js';
import { jsonFile } from './io.js';
import { mergeFeedback } from './feedback.js';

export function regularDirectory(dir: string): void {
  const s = lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Not a regular project directory');
}
export function readDesign(project: string, relative: unknown, folder: 'design' | 'pitch' = 'design'): DesignImage {
  if (typeof relative !== 'string' || !relative.startsWith(`${folder}/`) || relative.includes('\\') || relative.includes('\0')) throw Error('Invalid design path');
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw Error('Invalid design path');
  let dir = path.join(project, '.agent-office'); regularDirectory(dir);
  for (const part of parts.slice(0, -1)) { dir = path.join(dir, part); regularDirectory(dir); }
  const fd = openSync(path.join(dir, parts.at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > DRAFT_LIMITS.imageBytes) throw Error('Invalid design file');
    const buffer = Buffer.alloc(DRAFT_LIMITS.imageBytes + 1);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    return cleanImage(buffer.subarray(0, n));
  } finally { closeSync(fd); }
}

/** Resolve only explicit design paths; never publish arbitrary image metadata from draft.json. */
export function localDesign(project: string) {
  regularDirectory(path.join(project, '.agent-office'));
  const raw = jsonFile(path.join(project, '.agent-office/draft.json'));
  const images = new Map<string, DesignImage>();
  for (const [key, limit] of [['ideas', DRAFT_LIMITS.ideas], ['screens', DRAFT_LIMITS.screens]] as const) {
    for (const card of Array.isArray(raw?.[key]) ? raw[key].slice(0, limit) : []) {
      if (!card || typeof card !== 'object') continue;
      const source = card.image; delete card.image;
      if (images.size >= DRAFT_LIMITS.images) continue;
      try { const image = readDesign(project, source); images.set(image.meta.hash, image); card.image = image.meta; } catch { /* invalid images never leave this computer */ }
    }
  }
  const boards = mergeFeedback(project, cleanDraftBoards(raw));
  const referenced = new Set([...boards.ideas, ...boards.screens].flatMap(c => c.image ? [c.image.hash] : []));
  for (const hash of images.keys()) if (!referenced.has(hash)) images.delete(hash);
  return { boards, images };
}

/** Slow sockets must retry the same chunk, never silently skip bytes. Stop on reconnect. */
export async function sendDesignImages(floorId: string, images: Iterable<DesignImage>, sent: Set<string>,
  send: (frame: import('../../../shared/protocol/cubbies.js').CubbyNodeFrame) => boolean | void,
  current: () => boolean): Promise<void> {
  const currentImages = [...images];
  const referenced = new Set(currentImages.map(image => image.meta.hash));
  for (const hash of sent) if (!referenced.has(hash)) sent.delete(hash);
  for (const image of currentImages) {
    if (!current()) return;
    if (sent.has(image.meta.hash)) continue;
    const data = image.bytes.toString('base64'), total = Math.ceil(data.length / DRAFT_LIMITS.chunk);
    for (let index = 0; index < total; index++) {
      const frame = { t: 'cubby.design-image' as const, floorId, hash: image.meta.hash, mime: image.meta.mime,
        index, total, data: data.slice(index * DRAFT_LIMITS.chunk, (index + 1) * DRAFT_LIMITS.chunk) };
      const deadline = Date.now() + 30_000;
      while (current() && send(frame) === false) {
        if (Date.now() >= deadline) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!current()) return;
    }
    sent.add(image.meta.hash);
  }
}
