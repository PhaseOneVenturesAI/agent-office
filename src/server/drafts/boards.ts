import { DRAFT_LIMITS, type DraftBoards, type DraftFeedback, type DraftIdea, type DraftImage, type DraftScreen } from '../../shared/protocol/drafts.js';
const text = (v: unknown, max: number) => typeof v === 'string'
  ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const lines = (v: unknown) => Array.isArray(v) ? v.slice(0, 16).map(s => text(s, 300)).filter(Boolean) : [];
/** A card id: the one draft.json gives, else one made from the title; unique within the board. */
function cardId(raw: unknown, title: string, taken: Set<string>): string {
  let id = (typeof raw === 'string' && /^[\w-]{1,64}$/.test(raw) ? raw : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)) || 'card';
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
  taken.add(id);
  return id;
}
function feedback(v: unknown): DraftFeedback[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-DRAFT_LIMITS.feedbackPerCard).flatMap((f: any) => {
    const t = typeof f?.text === 'string' ? f.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, DRAFT_LIMITS.feedbackText) : '';
    return t && typeof f.id === 'string' && /^[\w-]{1,128}$/.test(f.id) && Number.isSafeInteger(f.at) ? [{ id: f.id, text: t, at: f.at }] : [];
  });
}
function image(v: any): DraftImage | undefined {
  if (!v || typeof v.hash !== 'string' || !/^[0-9a-f]{64}$/.test(v.hash) || !['image/png', 'image/jpeg', 'image/webp'].includes(v.mime)) return;
  const size = (n: unknown) => (Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 16384 ? n as number : 0);
  return { hash: v.hash, mime: v.mime, width: size(v.width), height: size(v.height) };
}
/** The same bounded publication schema is enforced both locally and at the relay boundary. */
export function cleanDraftBoards(raw: unknown): DraftBoards {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const taken = new Set<string>();
  const card = (s: any) => {
    const title = text(s?.title, 120), note = text(s?.note, DRAFT_LIMITS.note), img = image(s?.image);
    return title ? { id: cardId(s.id, title, taken), title, ...(note ? { note } : {}), ...(img ? { image: img } : {}), feedback: feedback(s.feedback) } : undefined;
  };
  const ideas: DraftIdea[] = [];
  for (const s of Array.isArray(r.ideas) ? r.ideas.slice(0, DRAFT_LIMITS.ideas) : []) { const c = card(s); if (c) ideas.push(c); }
  const screens: DraftScreen[] = [];
  for (const s of Array.isArray(r.screens) ? r.screens.slice(0, DRAFT_LIMITS.screens) : []) {
    if (!['sketch', 'review', 'approved'].includes(s?.status)) continue;
    const c = card(s); if (c) screens.push({ ...c, status: s.status });
  }
  const name = text(r.brand?.name, 80), tagline = text(r.brand?.tagline, 200);
  return { ideas, decisions: lines(r.decisions), plan: lines(r.plan), screens, brand: {
    ...(name ? { name } : {}), ...(tagline ? { tagline } : {}),
    colors: Array.isArray(r.brand?.colors) ? r.brand.colors.slice(0, 6)
      .filter((c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map((c: string) => c.toLowerCase()) : [],
  } };
}
