import type { DraftBoards, DraftScreen } from '../../shared/protocol/drafts.js';
const text = (v: unknown, max: number) => typeof v === 'string'
  ? v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const lines = (v: unknown) => Array.isArray(v) ? v.slice(0, 16).map(s => text(s, 300)).filter(Boolean) : [];
/** The same bounded publication schema is enforced both locally and at the relay boundary. */
export function cleanDraftBoards(raw: unknown): DraftBoards {
  const r = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const screens: DraftScreen[] = [];
  for (const s of Array.isArray(r.screens) ? r.screens.slice(0, 24) : []) {
    const title = text(s?.title, 120);
    if (title && ['sketch', 'review', 'approved'].includes(s.status)) screens.push({ title, status: s.status });
  }
  const name = text(r.brand?.name, 80), tagline = text(r.brand?.tagline, 200);
  return { decisions: lines(r.decisions), plan: lines(r.plan), screens, brand: {
    ...(name ? { name } : {}), ...(tagline ? { tagline } : {}),
    colors: Array.isArray(r.brand?.colors) ? r.brand.colors.slice(0, 6)
      .filter((c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map((c: string) => c.toLowerCase()) : [],
  } };
}
