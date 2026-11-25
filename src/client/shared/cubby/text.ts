// The words a cubby's windows use, in the 3D office and on the phone (/lite) alike: what each helper's
// called and what its card says, a factory run's clock, and the lead's color. No three.js and nothing
// from the 3D office's own folders, so the 2D view can load it (tests/client-structure.test.ts).

import type { CubbyAgent, CubbyRole, CubbyStatus } from '../../../shared/protocol/cubbies';

export const ROLE_LABEL: Record<CubbyRole, string> = {
  lead: 'Lead',
  builder: 'Builder',
  reviewer: 'Reviewer',
  factory: 'Factory',
  paradev: 'Paradev',
  direct: 'Local session',
};

export const STATUS_TEXT: Record<CubbyStatus, string> = { idle: 'ready', working: 'working', 'needs-you': 'needs you', unknown: 'unknown' };

/** A tool as people say it: "codex" is Codex, "claude-phase-one" is Claude. */
export function toolName(tool: string): string {
  const t = clip(tool || 'Agent', 20).replace(/^claude-(personal|phase-one)$/, 'claude');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A helper's short name: its tool and role ("Codex · Builder"), the role alone when they're the same word ("Factory"). */
export function helperName(a: Pick<CubbyAgent, 'tool' | 'role'>): string {
  const tool = toolName(a.tool);
  if (a.role === 'direct') return `${tool} session`;
  const role = ROLE_LABEL[a.role];
  return tool.toLowerCase() === role.toLowerCase() ? role : `${tool} · ${role}`;
}

/**
 * A helper's name tag and the card over its head. A session opened directly in its own app shows its
 * tool, branch and whether it's busy, never what it was asked: its conversation stays in that app.
 */
export function agentCard(a: CubbyAgent): { name: string; title: string; body: string } {
  const tool = toolName(a.tool);
  if (a.role === 'direct') return { name: `${tool} session`, title: a.status === 'working' ? 'Busy' : STATUS_TEXT[a.status], body: a.branch ? `🌿 ${clip(a.branch, 40)}` : '' };
  const title = clip(a.task || ROLE_LABEL[a.role], 60);
  const body = [a.progress ? clip(a.progress, 60) : '', a.branch ? `🌿 ${clip(a.branch, 40)}` : ''].filter(Boolean).join(' · ');
  return { name: helperName(a), title, body };
}

/** "12 min left" on the factory's clock, or "overdue". */
export function deadlineText(at: number | undefined, now: number): string {
  if (!at) return 'no deadline';
  const min = Math.ceil((at - now) / 60_000);
  if (min <= 0) return 'overdue';
  return min >= 120 ? `${Math.round(min / 60)} h left` : `${min} min left`;
}

/**
 * Which of the avatar colors a lead wears, from its name: one source for the cubby's lead, the draft
 * floor's greeter and the lead walking into the hall at kickoff, so it's the same character everywhere.
 */
export function leadColorIndex(leadName: string): number {
  let h = 2166136261;
  for (let i = 0; i < leadName.length; i++) h = Math.imul(h ^ leadName.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** `text` cut to at most `max` characters, with an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
