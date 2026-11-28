// The kickoff (cubbies step 3) without three.js: the hint at the studio table, the confirm rule, the
// kickoff moment's timeline (the lights coming on row by row, the covers flying off one row after
// another, the draft's panels going), the lead's walk into the cubby hall, and what the Design book,
// the brand poster and the elevator's "New" badge say. tests/kickoff-ui.test.ts checks these.

import type { DraftsState, Launched } from '../../../shared/protocol/drafts';
import { cleanDraftName } from '../../../shared/protocol/drafts';
import type { FloorInfo } from '../../../shared/protocol/floors';
import { CUBBY_DOORWAY, HALL_FRONT_X, HALL_PLACES } from '../../../shared/cubbyhall';
import { FLOOR } from '../../../shared/layout';
import { DIM, LEAD_SPOTS, PODS, clip, type Pod } from './model';

/** The key that kicks off at the studio table (E talks to the lead there). K: only the castle's herald has it, from the throne. */
export const KICKOFF_KEY = 'K';
export const KICKOFF_CODE = 'KeyK';
/** What the hint bar says when this office can't kick a draft off. */
export const NO_KICKOFF = 'Kickoff isn’t set up in this office';

/** What the studio table offers for kickoff: the key, or why not. Nothing off a draft of yours. */
export function kickoffOffer(d: Pick<DraftsState, 'here' | 'canKickoff'>): { can: true; label: string } | { can: false; why: string } | null {
  if (!d.here) return null;
  if (!d.here.studio) return { can: false, why: 'This draft predates the Mac Studio; start a New project' };
  return d.canKickoff ? { can: true, label: 'Kick off' } : { can: false, why: NO_KICKOFF };
}

/** Whether what's typed in the confirm box is the project's name (spaces tidied as the office tidies names). */
export function confirmMatches(typed: string, name: string): boolean {
  const t = cleanDraftName(typed);
  return !!t && t === cleanDraftName(name);
}

// ---- The kickoff moment -----------------------------------------------------------------------------

/** The desk rows, front (by the elevator, north) to back: each lights in turn. */
export const DESK_ROWS: readonly number[] = [...new Set(PODS.flatMap((p) => p.desks.map((d) => d.z)))].sort((a, b) => a - b);
/** When each row starts coming on, and how long it takes: the last is fully on at about 3 s. */
export const ROW_STEP_MS = 750;
export const ROW_RAMP_MS = 650;
/** How long a cover takes to fly up and fade, and how far after its row it starts on the east side. */
export const COVER_MS = 1300;
export const COVER_STAGGER_MS = 150;
/** The draft's panels (the boards, the brand wall, the table's lamp) fade over this, then the floor's itself again. */
export const PANELS_FADE = { from: 3000, to: 3800 } as const;
export const LEAVE_MS = PANELS_FADE.to;
/** When the lead sets off for the cubby hall, and how fast it walks (a brisk walk, m/s). */
export const LEAD_START_MS = 1200;
export const LEAD_SPEED = 2.4;
/** The longest the lead waits at the doorway for the hall to open before it goes in regardless. */
export const DOORWAY_WAIT_MS = 8000;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How far row `i` is on (0–1), `ms` after kickoff. */
export function rowLit(ms: number, i: number): number {
  return ease((ms - i * ROW_STEP_MS) / ROW_RAMP_MS);
}

/** How much of the floor's own light is on, `ms` after kickoff: from the draft's DIM up to all of it, a row at a time. */
export function lightLevel(ms: number): number {
  const n = DESK_ROWS.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rowLit(ms, i);
  return DIM + (1 - DIM) * (n ? sum / n : 1);
}

/** When a pod's cover starts to fly: with the first of its rows to come on, the east pod a beat after the west. */
export function coverStart(p: Pod): number {
  const row = Math.min(...p.desks.map((d) => DESK_ROWS.indexOf(d.z)));
  return row * ROW_STEP_MS + (p.x > -6 ? COVER_STAGGER_MS : 0);
}

/** How far a pod's cover is through flying off (0 on the desks, 1 gone), `ms` after kickoff. */
export function coverLift(ms: number, p: Pod): number {
  return Math.max(0, Math.min(1, (ms - coverStart(p)) / COVER_MS));
}

/** How much of the draft's panels is left (1 all there, 0 gone), `ms` after kickoff. */
export function panelsLeft(ms: number): number {
  return 1 - ease((ms - PANELS_FADE.from) / (PANELS_FADE.to - PANELS_FADE.from));
}

// ---- The lead's walk --------------------------------------------------------------------------------

export interface Point { x: number; z: number }

/** Inside cubby slot 0, past its glass front: where the lead walks to, and the cubby's own lead takes over. */
export const CUBBY_ZERO = { x: HALL_FRONT_X - 0.5, z: HALL_PLACES[0].z } as const;

/**
 * The lead's way from where it stands (by the studio table) to cubby slot 0: north of the desks and the
 * dance floor, west past the Issues kiosk, through the doorway in the old west wall, down the corridor
 * and in. `doorway` is the index of the point it waits at until the hall is open.
 */
export function leadPath(from: Point = LEAD_SPOTS.table): { points: Point[]; doorway: number } {
  const lane = -8.2;
  const points = [
    { x: from.x, z: from.z },
    { x: from.x, z: lane },
    { x: FLOOR.minX + 1.2, z: lane },
    { x: FLOOR.minX + 0.7, z: CUBBY_DOORWAY.u },
    { x: HALL_FRONT_X + 0.6, z: CUBBY_DOORWAY.u },
    { x: HALL_FRONT_X + 0.6, z: CUBBY_ZERO.z },
    { x: CUBBY_ZERO.x, z: CUBBY_ZERO.z },
  ];
  return { points, doorway: 3 };
}

/** How long a path is up to point `upTo` (all of it by default). */
export function pathLength(points: readonly Point[], upTo = points.length - 1): number {
  let d = 0;
  for (let i = 1; i <= upTo; i++) d += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return d;
}

/** Where on the path `d` meters along it is, which way it's heading there (rotY), and whether that's the end. */
export function along(points: readonly Point[], d: number): { x: number; z: number; rotY: number; done: boolean } {
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === points.length - 1) {
      const t = len ? Math.min(1, left / len) : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, rotY: Math.atan2(b.x - a.x, b.z - a.z), done: i === points.length - 1 && left >= len };
    }
    left -= len;
  }
  const p = points[points.length - 1];
  return { x: p.x, z: p.z, rotY: 0, done: true };
}

// ---- What a kicked-off floor keeps ------------------------------------------------------------------

/** The Design book's panel: its title, the brand, and the approved screens (or what to say when there are none). */
export function designBook(l: Launched): { title: string; brand: string; tagline: string; colors: string[]; screens: string[]; empty: string } {
  return {
    title: `📘 Design · ${clip(l.name, 28)}`,
    brand: clip(l.brand.name || l.name, 40),
    tagline: clip(l.brand.tagline ?? '', 100),
    colors: l.brand.colors.slice(0, 6),
    screens: l.screens.map((s) => clip(s, 60)).filter(Boolean),
    empty: 'No screens were approved before kickoff.',
  };
}

/** What the framed poster by the elevator shows. */
export function posterOf(l: Launched): { name: string; tagline: string; colors: string[] } {
  return { name: clip(l.brand.name || l.name, 22), tagline: clip(l.brand.tagline ?? '', 60), colors: l.brand.colors.slice(0, 6) };
}

/** Whether a floor wears the "New" badge in the elevator (it's kicked off recently, and not one of your drafts). */
export function wearsNew(f: Pick<FloorInfo, 'isNew' | 'draft'>): boolean {
  return f.isNew === true && f.draft !== true;
}
