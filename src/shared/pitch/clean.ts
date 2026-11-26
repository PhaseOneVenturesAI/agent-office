import { validDraftImageSize, type DraftImage } from '../protocol/drafts.js';
import { PITCH_LIMITS, type Pitch, type PitchKind, type PitchPiece, type PitchStamp } from '../protocol/pitch.js';
import { checkTvUrl } from '../tv.js';
const text = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trimEnd() : '';
export const pitchId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
/** No credentials, relative URLs, insecure protocols or parser-normalized control characters. */
export function pitchUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048 || !/^https:\/\//i.test(raw) || /^https:\/\/[^/?#]*@/i.test(raw) || /[\x00-\x20\x7f\\]/.test(raw)) return;
  try { const u = new URL(raw); if (u.protocol === 'https:' && u.hostname && !u.username && !u.password) return u.href; } catch { /* invalid */ }
}
export function cleanStamp(raw: any): PitchStamp | undefined {
  if (!raw || !['approve', 'change', 'drop'].includes(raw.verdict) || typeof raw.requestId !== 'string' ||
    !/^[\w-]{1,128}$/.test(raw.requestId) || !Number.isSafeInteger(raw.at)) return;
  const note = text(raw.note, PITCH_LIMITS.note);
  if (raw.verdict === 'change' && !note) return;
  return { requestId: raw.requestId, verdict: raw.verdict, at: raw.at, ...(note ? { note } : {}) };
}
export function validVerdict(raw: any): boolean {
  return !!raw && pitchId(raw.pieceId) && typeof raw.version === 'string' && !!raw.version.trim() && raw.version.length <= 64 &&
    (raw.note === undefined || (typeof raw.note === 'string' && raw.note.length <= PITCH_LIMITS.note)) && !!cleanStamp(raw);
}
function image(v: any): DraftImage | undefined {
  if (!v || typeof v.hash !== 'string' || !/^[0-9a-f]{64}$/.test(v.hash) ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(v.mime) || !validDraftImageSize(v.width, v.height)) return;
  return { hash: v.hash, mime: v.mime, width: v.width, height: v.height };
}
/** Shared boundary cleaner: used by the computer, relay and browser. Never forwards arbitrary fields. */
export function cleanPitch(raw: any): Pitch | undefined {
  if (!raw || !['building', 'ready'].includes(raw.status)) return;
  const department = text(raw.department, 60), lead = text(raw.lead, 80), version = text(raw.version, 64);
  if (!department || !lead || !version) return;
  const pieces: PitchPiece[] = [], kinds = new Set<PitchKind>(), ids = new Set<string>();
  for (const p of Array.isArray(raw.pieces) ? raw.pieces.slice(0, PITCH_LIMITS.pieces) : []) {
    if (!p || !pitchId(p.id) || ids.has(p.id) || !['site', 'video', 'slides', 'ads'].includes(p.kind) || kinds.has(p.kind)) continue;
    const title = text(p.title, 120); if (!title) continue;
    ids.add(p.id); kinds.add(p.kind);
    const img = p.kind === 'site' || p.kind === 'video' ? image(p.image) : undefined, url = p.kind === 'site' ? pitchUrl(p.url) : undefined;
    const youtube = p.kind === 'video' && typeof p.youtube === 'string' && /^[\w-]{11}$/.test(p.youtube) &&
      !('error' in checkTvUrl(`https://www.youtube.com/watch?v=${p.youtube}`)) ? p.youtube : undefined;
    const cap = p.kind === 'slides' ? PITCH_LIMITS.slides : p.kind === 'ads' ? PITCH_LIMITS.ads : 0;
    const images = (Array.isArray(p.images) ? p.images.slice(0, cap) : []).map(image).filter((i: DraftImage | undefined): i is DraftImage => !!i);
    const stamp = cleanStamp(p.stamp);
    pieces.push({ id: p.id, kind: p.kind, title, notes: (Array.isArray(p.notes) ? p.notes.slice(0, 8) : []).map((v: unknown) => text(v, 300)).filter(Boolean),
      images, ...(img ? { image: img } : {}), ...(url ? { url } : {}), ...(youtube ? { youtube } : {}), ...(stamp ? { stamp } : {}) });
  }
  return { department, lead, status: raw.status, version, pieces };
}
export const pitchImages = (p?: Pitch) => p?.pieces.flatMap(c => [...(c.image ? [c.image] : []), ...c.images]) ?? [];
