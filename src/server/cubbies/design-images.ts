import { DRAFT_LIMITS, type DraftBoards, type DraftImage } from '../../shared/protocol/drafts.js';
import { cleanImage, type DesignImage } from '../drafts/image-format.js';
const encodedLimit = Math.ceil(DRAFT_LIMITS.imageBytes / 3) * 4;
type Pending = { mime: DraftImage['mime']; total: number; parts: string[]; size: number };
/** One draft's private, bounded memory. Never attached to the shared image cache. */
export class DraftImages {
  private referenced = new Map<string, DraftImage>();
  private complete = new Map<string, DesignImage>();
  private pending = new Map<string, Pending>();
  boards(boards: DraftBoards): void {
    this.references([...boards.ideas, ...boards.screens].flatMap(c => c.image ? [c.image] : []), DRAFT_LIMITS.images);
  }
  references(images: DraftImage[], limit: number): void {
    this.referenced.clear();
    for (const image of images) if (this.referenced.size < limit) this.referenced.set(image.hash, image);
    for (const hash of this.complete.keys()) if (!this.referenced.has(hash)) this.complete.delete(hash);
    for (const hash of this.pending.keys()) if (!this.referenced.has(hash)) this.pending.delete(hash);
  }
  reconnect() { this.pending.clear(); }
  get(hash: string) { return this.complete.get(hash); }
  accept(f: Record<string, unknown>): boolean {
    const hash = f.hash;
    if (typeof hash !== 'string' || !this.referenced.has(hash) || this.complete.has(hash)) return false;
    const reject = () => { this.pending.delete(hash); return false; };
    const meta = this.referenced.get(hash)!;
    if (f.mime !== meta.mime || !Number.isInteger(f.index) || !Number.isInteger(f.total) ||
      (f.total as number) < 1 || (f.total as number) > Math.ceil(encodedLimit / DRAFT_LIMITS.chunk) ||
      typeof f.data !== 'string' || !f.data.length || f.data.length > DRAFT_LIMITS.chunk ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data) || f.data.length % 4 !== 0) return reject();
    if (f.index === 0) this.pending.set(hash, { mime: meta.mime, total: f.total as number, parts: [], size: 0 });
    const p = this.pending.get(hash);
    if (!p || f.index !== p.parts.length || f.total !== p.total || p.size + f.data.length > encodedLimit ||
      ((f.index as number) < p.total - 1 && (f.data.length !== DRAFT_LIMITS.chunk || f.data.includes('=')))) return reject();
    p.parts.push(f.data); p.size += f.data.length;
    if (p.parts.length !== p.total) return false;
    this.pending.delete(hash);
    try {
      const base64 = p.parts.join(''), bytes = Buffer.from(base64, 'base64');
      if (bytes.toString('base64') !== base64) return false;
      const image = cleanImage(bytes);
      // Also refuse unstripped metadata: the wire's hash names exactly the cleaned bytes.
      if (!bytes.equals(image.bytes) || image.meta.hash !== hash || image.meta.mime !== p.mime ||
        image.meta.width !== meta.width || image.meta.height !== meta.height) return false;
      this.complete.set(hash, image); return true;
    } catch { return false; }
  }
}
