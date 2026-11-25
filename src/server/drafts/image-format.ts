import { createHash } from 'node:crypto';
import { DRAFT_LIMITS, validDraftImageSize, type DraftImage } from '../../shared/protocol/drafts.js';
export interface DesignImage { meta: DraftImage; bytes: Buffer }
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const fail = (): never => { throw Error('Invalid design image'); };

/** Structural parsing only: never invoke a decoder or trust a filename/mime supplied by a peer. */
export function cleanImage(input: Buffer): DesignImage {
  if (!input.length || input.length > DRAFT_LIMITS.imageBytes) fail();
  let bytes: Buffer, mime: DraftImage['mime'], width = 0, height = 0;
  if (input.subarray(0, 8).equals(pngSignature)) {
    mime = 'image/png';
    const parts: Buffer[] = [pngSignature]; let p = 8, header = false, data = false, end = false;
    while (p + 12 <= input.length) {
      const n = input.readUInt32BE(p), type = input.toString('ascii', p + 4, p + 8), next = p + n + 12;
      if (next > input.length || end || (!header && type !== 'IHDR')) fail();
      if (type === 'IHDR') {
        if (header || n !== 13) fail();
        header = true; width = input.readUInt32BE(p + 8); height = input.readUInt32BE(p + 12);
      }
      if (type === 'IDAT') data = true;
      if (type === 'IEND') { if (n !== 0) fail(); end = true; }
      if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB'].includes(type)) parts.push(input.subarray(p, next));
      p = next;
    }
    if (!header || !data || !end || p !== input.length) fail();
    bytes = Buffer.concat(parts);
  } else if (input[0] === 0xff && input[1] === 0xd8) {
    mime = 'image/jpeg';
    const parts = [input.subarray(0, 2)]; let p = 2, end = false, scan = false;
    while (p < input.length) {
      const start = p;
      if (input[p++] !== 0xff) fail();
      while (input[p] === 0xff) p++;
      const marker = input[p++];
      if (marker === 0xd9) { parts.push(input.subarray(start, p)); end = true; break; }
      if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) fail();
      if (p + 2 > input.length) fail();
      const n = input.readUInt16BE(p), next = p + n;
      if (n < 2 || next > input.length) fail();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (n < 8) fail(); height = input.readUInt16BE(p + 3); width = input.readUInt16BE(p + 5);
        if (!validDraftImageSize(width, height)) fail();
      }
      if (!(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe) parts.push(input.subarray(start, next));
      p = next;
      if (marker === 0xda) {
        scan = true; const begin = p;
        while (p < input.length) {
          if (input[p] !== 0xff) { p++; continue; }
          let q = p + 1; while (input[q] === 0xff) q++;
          if (input[q] === 0 || (input[q] >= 0xd0 && input[q] <= 0xd7)) { p = q + 1; continue; }
          break;
        }
        parts.push(input.subarray(begin, p));
      }
    }
    if (!end || !scan || p !== input.length) fail();
    bytes = Buffer.concat(parts);
  } else if (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp';
    if (input.readUInt32LE(4) + 8 !== input.length) fail();
    const parts: Buffer[] = []; let p = 12, data = false;
    while (p + 8 <= input.length) {
      const type = input.toString('ascii', p, p + 4), n = input.readUInt32LE(p + 4), next = p + 8 + n + (n & 1);
      if (next > input.length) fail();
      const chunk = Buffer.from(input.subarray(p, next)), d = chunk.subarray(8, 8 + n);
      if (type === 'VP8X') {
        if (n !== 10 || (d[0] & 2)) fail(); // Animation may embed nested metadata; only still designs.
        d[0] &= ~(0x20 | 0x08 | 0x04);
        width = d.readUIntLE(4, 3) + 1; height = d.readUIntLE(7, 3) + 1;
        if (!validDraftImageSize(width, height)) fail();
      } else if (type === 'VP8 ') {
        if (n < 10 || !d.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) fail();
        const w = d.readUInt16LE(6) & 0x3fff, h = d.readUInt16LE(8) & 0x3fff;
        if (!validDraftImageSize(w, h) || (width && (width !== w || height !== h))) fail();
        data = true; width = w; height = h;
      } else if (type === 'VP8L') {
        if (n < 5 || d[0] !== 0x2f) fail();
        const v = d.readUInt32LE(1), w = (v & 0x3fff) + 1, h = ((v >>> 14) & 0x3fff) + 1;
        if (!validDraftImageSize(w, h) || (width && (width !== w || height !== h))) fail();
        data = true; width = w; height = h;
      }
      // Only codec chunks survive; unknown chunks could carry private metadata too.
      if (['VP8X', 'VP8 ', 'VP8L', 'ALPH'].includes(type)) parts.push(chunk);
      p = next;
    }
    if (!data || p !== input.length) fail();
    const header = Buffer.from(input.subarray(0, 12));
    header.writeUInt32LE(4 + parts.reduce((n, b) => n + b.length, 0), 4);
    bytes = Buffer.concat([header, ...parts]);
  } else return fail();
  if (!validDraftImageSize(width, height)) fail();
  return { bytes, meta: { hash: createHash('sha256').update(bytes).digest('hex'), mime, width, height } };
}
