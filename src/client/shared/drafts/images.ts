// The design board's images (cubbies step 5), on the owner's own page only: fetched from the office
// with this browser's session (same origin), decoded once into an ImageBitmap and kept by hash, so the
// wall, the phone's list and the card window all draw the same one. The bytes never leave this page.

import { DRAFT_LIMITS, draftImageUrl, type DraftImage } from '../../../shared/protocol/drafts';

const HASH = /^[0-9a-f]{64}$/;
/** null: it didn't load (the card shows as text). */
const done = new Map<string, ImageBitmap | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

async function load(floorId: string, hash: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(draftImageUrl(floorId, hash), { credentials: 'same-origin', cache: 'force-cache' });
    if (!res.ok || !/^image\/(png|jpeg|webp)$/.test(res.headers.get('content-type')?.split(';')[0].trim() ?? '')) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > DRAFT_LIMITS.imageBytes) return null;
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * The image if it's loaded, null if it couldn't be, undefined while it's on its way (it starts
 * loading on the first ask, and everyone listening hears once it's in).
 */
export function draftImage(floorId: string, img: DraftImage | undefined): ImageBitmap | null | undefined {
  if (!img || !HASH.test(img.hash)) return null;
  const k = `${floorId}/${img.hash}`;
  if (done.has(k)) return done.get(k);
  if (!loading.has(k)) {
    loading.add(k);
    void load(floorId, img.hash).then((bmp) => {
      loading.delete(k);
      done.set(k, bmp);
      for (const fn of listeners) fn();
    });
  }
  return undefined;
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
