// The studio wing: a walk-in annex behind the office's north wall, reached through a doorway in the
// gap between the task-queue board and the PR board (the PR board's kiosk stands a little to the east
// of the doorway, still in front of its board). A hallway runs the width of the annex behind the wall,
// with three glass-walled studios off it: Marketing, Product and Development. The rooms are set
// dressing — each has a sign that opens the floor's Departments panel (see features/departments), not
// desks of its own: every existing seat stays where it is.
//
// The annex sits on the office's own city block, behind the building and short of the street behind
// it: its back wall keeps clear of the sidewalk, and it stays west of the back office's bay (WING) so
// building that out is unaffected.

import { FLOOR, SLAB, WALL_HEIGHT, WALL_T } from './layout.js';

/** The doorway through the north wall into the annex. */
export const STUDIO_DOOR = { wall: 'north' as const, u: 0, width: 1.8, y0: 0, y1: 2.4 };

export const STUDIO_WING = {
  /** The doorway through the office's north wall (see STUDIO_DOOR). */
  door: { x: STUDIO_DOOR.u, width: STUDIO_DOOR.width },
  /** The annex's inside faces east and west. */
  minX: -11,
  maxX: 11,
  /** The hallway runs from the back of the office's north wall to the studios' glass wall. */
  frontZ: FLOOR.minZ - WALL_T,
  /** The middle of the glass wall between the hallway and the studios. */
  glassZ: -16.45,
  /** The inside face of the annex's back wall (its windows look out on the street behind). */
  backZ: -21.4,
  /** As tall as the office room. */
  height: WALL_HEIGHT,
} as const;

/** One of the studios: a glass-walled room off the hallway, named and signed by its discipline. */
export interface StudioRoom {
  /** The departments preset it stands for (see shared/protocol); development has no preset yet. */
  preset: 'marketing' | 'product' | 'development';
  name: string;
  icon: string;
  color: string;
  minX: number;
  maxX: number;
  /** The middle of its doorway from the hallway. */
  doorX: number;
  /** Its back-wall window's sill and head: above anything hung under it. */
  windowY: [number, number];
  /** Its corner plant, by the glass wall. */
  plant: [number, number];
}

/** The three studios, west to east, each 7–8 m wide. */
export const STUDIO_WING_ROOMS: readonly StudioRoom[] = [
  { preset: 'marketing', name: 'Marketing studio', icon: '📣', color: '#ef476f', minX: -11, maxX: -4, doorX: -7.5, windowY: [1.1, 3.3], plant: [-10.5, -17.2] },
  { preset: 'product', name: 'Product studio', icon: '🛠️', color: '#06d6a0', minX: -4, maxX: 4, doorX: 0, windowY: [3.0, 4.4], plant: [-3.5, -17.0] },
  { preset: 'development', name: 'Development studio', icon: '⚙️', color: '#118ab2', minX: 4, maxX: 11, doorX: 7.5, windowY: [1.1, 3.3], plant: [4.6, -17.1] },
] as const;

/** Half the width of a studio doorway. */
export const STUDIO_DOOR_HALF = 0.7;

/**
 * The floor support the annex registers with the office (pushed as a collider by
 * world/office/studio-wing.ts, tested against shared/player groundAt): a slab like the room's and
 * the back office's, meeting the office floor at the doorway. Without it there is nothing under
 * the annex and whoever walks in drops to the street below.
 */
export const STUDIO_WING_FLOOR = { minX: STUDIO_WING.minX - WALL_T, maxX: STUDIO_WING.maxX + WALL_T, minZ: STUDIO_WING.backZ - WALL_T, maxZ: STUDIO_WING.frontZ, bottom: -SLAB, top: 0 };

/**
 * The wing's set dressing, as rectangles in the way on the floor (minX, maxX, minZ, maxZ): the
 * marketing moodboard and its table, the product planning table, the development bench, rack and
 * spools. The hallway stays clear. The client builds the props themselves over these footprints
 * (world/office/studio-wing.ts) and shared/nav.ts keeps walkers round them.
 */
export const STUDIO_WING_PROPS: readonly (readonly [number, number, number, number])[] = [
  // The hallway's standing directory, just east of the doorway (the hallway is otherwise clear).
  [2.35, 2.85, -15.3, -13.7],
  // Marketing: the moodboard easel along the west wall, a table with poufs by the back wall, the
  // prop shelf under the window, and a plant in the corner by the glass.
  [-10.9, -10.2, -20.3, -19.2],
  [-8.9, -7.9, -21.0, -20.1],
  [-6.7, -5.5, -21.35, -20.85],
  [-10.7, -10.3, -17.4, -17.0],
  // Product: the planning table in the middle of the room, and a plant by the glass.
  [-0.9, 0.9, -20.3, -19.3],
  [-3.7, -3.3, -17.2, -16.8],
  // Development: the workstation bench along the back wall, the rack and spools by the east wall,
  // and a plant by the glass.
  [4.7, 9.7, -21.4, -20.5],
  [10.3, 11.0, -19.9, -18.9],
  [9.9, 10.4, -19.0, -18.4],
  [4.4, 4.8, -17.3, -16.9],
];

/** Whether (x, z) is in the studio wing's hallway or one of its studios: the wing's walkable floor.
 * The doorway seam through the wall counts too, for the camera's indoor handling. */
export function inStudioWing(x: number, z: number): boolean {
  return x > STUDIO_WING.minX && x < STUDIO_WING.maxX && z > STUDIO_WING.backZ && z < STUDIO_WING.frontZ + 0.35;
}
