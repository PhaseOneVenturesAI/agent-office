// The design board's images (cubbies step 5), on the owner's own page only: fetched from the office
// with this browser's session (same origin), decoded once into an ImageBitmap and kept by hash, so the
// wall, the phone's list and the card window all draw the same one. The bytes never leave this page.

import { DRAFT_LIMITS, draftImageUrl, validDraftImageSize, type DraftImage, type DraftView } from '../../../shared/protocol/drafts';
import { DraftImageCache } from './image-cache';

const HASH = /^[0-9a-f]{64}$/;
const cache = new DraftImageCache<ImageBitmap>(24);
let referenced = new Set<string>();
const listeners = new Set<() => void>();

/** Release removed images and all resources from a departed or kicked-off draft, including pending loads. */
export function syncDraftImages(draft?: DraftView): void {
  referenced = new Set(draft ? [...draft.boards.ideas, ...draft.boards.screens]
    .flatMap(card => card.image ? [`${draft.id}/${card.image.hash}`] : []) : []);
  cache.retain(referenced);
}

async function load(floorId: string, img: DraftImage, signal: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(draftImageUrl(floorId, img.hash), { credentials: 'same-origin', cache: 'no-store', signal });
    if (!res.ok || !/^image\/(png|jpeg|webp)$/.test(res.headers.get('content-type')?.split(';')[0].trim() ?? '')) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > DRAFT_LIMITS.imageBytes || signal.aborted) return null;
    const bmp = await createImageBitmap(blob);
    if (!validDraftImageSize(bmp.width, bmp.height) || bmp.width !== img.width || bmp.height !== img.height) {
      bmp.close();
      return null;
    }
    return bmp;
  } catch {
    return null;
  }
}

/** The decoded image, null for a text card, or undefined while loading. Check pixels before fetching. */
export function draftImage(floorId: string, img: DraftImage | undefined): ImageBitmap | null | undefined {
  if (!img || !HASH.test(img.hash) || !validDraftImageSize(img.width, img.height)) return null;
  const key = `${floorId}/${img.hash}`;
  if (!referenced.has(key)) return null;
  return cache.get(key, signal => load(floorId, img, signal), () => { for (const fn of listeners) fn(); });
}

/** Hears every image that finishes loading (or fails to); returns how to stop. */
export function onDraftImage(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Draws `bmp` filling the box, cropped from its middle (a thumbnail). */
export function drawCover(c: CanvasRenderingContext2D, bmp: ImageBitmap, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / bmp.width, h / bmp.height);
  const sw = w / s;
  const sh = h / s;
  c.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x, y, w, h);
}

/** A canvas showing `bmp` whole at its own size (CSS scales it down), for the card window and the phone. */
export function imageCanvas(bmp: ImageBitmap, cls = ''): HTMLCanvasElement {
  const el = document.createElement('canvas');
  if (cls) el.className = cls;
  el.width = bmp.width;
  el.height = bmp.height;
  el.getContext('2d')!.drawImage(bmp, 0, 0);
  return el;
}

/** A small square canvas with `bmp` cropped to fill it (the phone's list). */
export function thumbCanvas(bmp: ImageBitmap, size: number, cls = ''): HTMLCanvasElement {
  const el = document.createElement('canvas');
  if (cls) el.className = cls;
  el.width = el.height = size;
  drawCover(el.getContext('2d')!, bmp, 0, 0, size, size);
  return el;
}
