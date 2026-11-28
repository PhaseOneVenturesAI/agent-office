import { pitchId, pitchImage } from './clean.js';
import type { Pitch, PitchCost, PitchDirection } from '../protocol/pitch.js';
const text = (v: unknown, n: number) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '';
const money = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1_000_000;
/** Additive, bounded publication fields. Never forward arbitrary JSON or image paths. */
export function cleanPitchFlow(raw: any): Partial<Pitch> {
  const out: Partial<Pitch> = {};
  if (raw.brief && typeof raw.brief === 'object') {
    const b = raw.brief;
    out.brief = { title: text(b.title, 120), audience: text(b.audience, 300), goal: text(b.goal, 300),
      constraints: (Array.isArray(b.constraints) ? b.constraints.slice(0, 8) : typeof b.constraints === 'string' ? [b.constraints] : []).map((v: unknown) => text(v, 200)).filter(Boolean) };
  }
  if (Array.isArray(raw.directions)) {
    const seen = new Set<string>();
    out.directions = raw.directions.slice(0, 3).flatMap((d: any): PitchDirection[] => {
      if (!d || !pitchId(d.id) || seen.has(d.id) || !text(d.title, 120)) return [];
      seen.add(d.id); const image = pitchImage(d.image);
      return [{ id: d.id, title: text(d.title, 120), summary: text(d.summary, 600), ...(image ? { image } : {}) }];
    });
    if (out.directions?.some(d => d.id === raw.picked)) out.picked = raw.picked;
  }
  if (Array.isArray(raw.costs)) {
    const seen = new Set<string>();
    out.costs = raw.costs.slice(0, 24).flatMap((c: any): PitchCost[] => {
      if (!c || !pitchId(c.id) || seen.has(c.id) || !text(c.tool, 80) || !text(c.what, 300) || !money(c.estimate) || !['asked', 'ok', 'declined', 'spent'].includes(c.status)) return [];
      seen.add(c.id);
      return [{ id: c.id, tool: text(c.tool, 80), what: text(c.what, 300), estimate: c.estimate, status: c.status, ...(money(c.spent) ? { spent: c.spent } : {}) }];
    });
  }
  if (money(raw.budget?.session)) out.budget = { session: raw.budget.session };
  return out;
}
