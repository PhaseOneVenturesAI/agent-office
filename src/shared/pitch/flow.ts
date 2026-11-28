import type { Pitch, PitchCost } from '../protocol/pitch.js';
export const DEPARTMENTS = ['Marketing', 'Design', 'Product', 'Growth/Sales', 'Support'] as const;
export const sameDepartment = (a: string, b: string) => a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');
export const kickoffText = (project: string, department: string) => `Start a pitch brief for ${project} ${department}: ask Jonathan 3–5 short questions here, then write the brief to \`.agent-office/pitch.json\` \`brief\` and pin 2–3 cheap directions in \`directions\`.`;
export const pickText = (id: string, title: string) => `Jonathan picked direction ${title} (${id})`;
export const costText = (cost: PitchCost, ok: boolean) => ok ? `Jonathan OKs cost ${cost.id} (${cost.what}, up to $${cost.estimate}) for this one call` : `Jonathan declines cost ${cost.id}`;
export const cents = (n: number) => Math.ceil(n * 100 - 1e-8);
export function pitchSpend(p: Pitch) {
  const spent = (p.costs ?? []).reduce((n, c) => n + cents(c.spent ?? 0), 0);
  const reserved = (p.costs ?? []).reduce((n, c) => n + (c.status === 'ok' ? Math.max(0, cents(c.estimate) - cents(c.spent ?? 0)) : 0), 0);
  return { spent: spent / 100, reserved: reserved / 100, remaining: Math.max(0, Math.floor((p.budget?.session ?? 0) * 100 + 1e-8) - spent - reserved) / 100 };
}
