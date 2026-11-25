// A draft floor's layout and words, without three.js: where the desk pods are and which ones are
// uncovered, where the studio table and the lead stand, what each board is called and says when it's
// empty, and the screens' status chips. tests/drafts-ui.test.ts checks these.

import type { DraftBoards, DraftScreen, DraftView } from '../../../shared/protocol/drafts';
import { DESKS, ELEVATOR, ELEVATOR_FRONT, WHITEBOARD, type DeskDef } from '../../../shared/layout';

/** One pod of desks: four desks back to back, and the floor they cover with their chairs. */
export interface Pod {
  id: string;
  x: number;
  z: number;
  /** Across (x) and deep (z), chairs included. */
  width: number;
  depth: number;
  desks: DeskDef[];
}

/** The desk pods on the office floor, from DESKS: grouped by the cluster each desk is in and the side of the room. */
export const PODS: readonly Pod[] = (() => {
  const by = new Map<string, DeskDef[]>();
  for (const d of DESKS) {
    const k = `${d.x < -6 ? 'w' : 'e'}${d.z < 0 ? 'n' : 's'}`;
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  return [...by].map(([id, desks]) => {
    const xs = desks.map((d) => d.x);
    const zs = desks.map((d) => d.z);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const z = (Math.min(...zs) + Math.max(...zs)) / 2;
    // Two desks across (2.2 m each), two rows of 1.1 m with a chair out behind each row.
    return { id, x, z, width: Math.max(...xs) - Math.min(...xs) + 2.4, depth: Math.max(...zs) - Math.min(...zs) + 2.9, desks };
  });
})();

/** The studio table, where the whiteboard stands on an open floor; the lamp hangs over it. */
export const STUDIO = { x: WHITEBOARD.x, z: WHITEBOARD.z, width: 2.6, depth: 1.3, height: 0.78, lampY: 3.1 } as const;

/** The pods, nearest the studio table first: the order designers uncover them in. */
export const PODS_BY_STUDIO: readonly Pod[] = [...PODS].sort((a, b) => Math.hypot(a.x - STUDIO.x, a.z - STUDIO.z) - Math.hypot(b.x - STUDIO.x, b.z - STUDIO.z));

/** The pods a draft has uncovered: one per designer working, two at most, nearest the studio table first. */
export function uncoveredPods(designers: number): Set<string> {
  const n = Math.max(0, Math.min(2, Math.floor(designers) || 0));
  return new Set(PODS_BY_STUDIO.slice(0, n).map((p) => p.id));
}

/** Where the lead waits: just outside the elevator's doors to greet you, then by the studio table. */
export const LEAD_SPOTS = {
  greet: { x: ELEVATOR.x + 1.3, z: ELEVATOR_FRONT + 3.3, rotY: Math.PI - 0.3 },
  // Behind the table (its north side), facing into the room, clear of the table's sign.
  table: { x: STUDIO.x + 0.9, z: STUDIO.z - STUDIO.depth / 2 - 0.55, rotY: 0 },
} as const;

/** Whether you've walked on past the lead at the doors: further into the room than it, or well away from the doors. */
export function walkedPast(x: number, z: number): boolean {
  if (z < ELEVATOR_FRONT + 0.2) return false;
  return z > LEAD_SPOTS.greet.z + 0.6 || Math.hypot(x - ELEVATOR.x, z - ELEVATOR_FRONT) > 6.5;
}

/** A name cut to `max` characters, with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** What the lead's called: the draft's, else its cubby's, else "Your lead". */
export function leadName(here: Pick<DraftView, 'leadName'> | undefined, cubbyLead?: string): string {
  return clip(here?.leadName || cubbyLead || '', 20) || 'Your lead';
}

/** What the lead says at the doors. */
export function greeting(here: Pick<DraftView, 'name'>): string {
  return `Welcome to ${clip(here.name, 28)}`;
}

/** The north boards on a draft, in the Issues, Task queue and PR boards' places. */
export type BoardKey = 'decisions' | 'plan' | 'screens';
export const DRAFT_BOARDS: readonly { key: BoardKey; at: 'issues' | 'queue' | 'pulls'; title: string; empty: string }[] = [
  { key: 'decisions', at: 'issues', title: '📝 Decisions', empty: 'Your lead’s decisions will appear here' },
  { key: 'plan', at: 'queue', title: '🗺️ Plan', empty: 'The plan appears here once the decisions are in' },
  { key: 'screens', at: 'pulls', title: '🖼️ Screens', empty: 'Screens your helpers draw hang here for your ✓' },
];
export const BRAND_TITLE = '🎨 Brand wall';
export const BRAND_EMPTY = 'Your brand’s name, tagline and colors will appear here';

/** A screen's status chip. */
export const SCREEN_CHIP: Record<DraftScreen['status'], { text: string; bg: string; color: string }> = {
  sketch: { text: '✏️ sketch', bg: '#e9ecef', color: '#2b2d42' },
  review: { text: '👀 review', bg: '#ffd166', color: '#2b2d42' },
  approved: { text: '✓ approved', bg: '#06d6a0', color: '#2b2d42' },
};

/** At most `max` of `items`, the last one saying how many more there are when they don't all fit. */
export function shown<T>(items: readonly T[], max: number): { items: T[]; more: number } {
  if (items.length <= max) return { items: [...items], more: 0 };
  return { items: items.slice(0, max - 1), more: items.length - max + 1 };
}

/** What a board shows: its lines (each screen's title for the screens), and whether it's still empty. */
export function boardLines(b: DraftBoards, key: BoardKey): string[] {
  return key === 'screens' ? b.screens.map((s) => s.title) : b[key];
}

/** Whether the brand wall has anything on it yet. */
export function brandEmpty(b: DraftBoards['brand']): boolean {
  return !b.name && !b.tagline && !b.colors.length;
}

/** What E does at the studio table and the lead: talk to the lead once there's a cubby, else set one up. */
export function studioAction(here: Pick<DraftView, 'cubbyId'>, lead: string): { label: string; talk: boolean } {
  return here.cubbyId ? { label: `Talk to ${lead}`, talk: true } : { label: 'Set up', talk: false };
}

/** How much of the floor's own light is left on a draft (the lamp over the table is its own). */
export const DIM = 0.1;
