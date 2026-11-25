// The cubby hall: a strip of building added west of the office's west wall on a floor that has cubbies
// (see features/cubbies), with four glass-fronted cubbies down its west side facing east onto a corridor
// along the old wall, and a doorway through that wall near its north end. Pure geometry, no three.js:
// the client builds it from this, and the tests check it stays clear of the street, the exit stairs,
// the ladder and the machine monitor.
//
// It runs from the north wall to just short of the exit door's landing, so the bottom floor's way out
// and its stairs down to the street are untouched; its outer wall stands well short of the west road.

import { EXIT_DOOR, EXIT_STAIRS, FLOOR, WALL_T, type Opening } from './layout.js';

/** The hall inside its walls: x from its outer west wall to the old west wall's outer face. */
export const CUBBY_HALL = {
  minX: -23.6,
  maxX: FLOOR.minX - WALL_T,
  minZ: FLOOR.minZ,
  maxZ: 5.3,
} as const;

/** How wide the corridor along the old west wall is (2.4 m, widened from 1.2: Jonathan, 2026-11-25), and how thick the partitions between cubbies. */
export const HALL_CORRIDOR = 2.4;
export const HALL_PARTITION = 0.1;
/** How tall the partitions between cubbies are (the glass fronts are FRONT_HEIGHT, 2.7). */
export const PARTITION_HEIGHT = 3.2;
/** How many cubbies the hall has: four roomy ones rather than six cramped ones (Jonathan, 2026-11-25). */
export const HALL_SLOTS = 4;
/** Where the cubbies' glass fronts stand, facing east onto the corridor. */
export const HALL_FRONT_X = CUBBY_HALL.maxX - HALL_CORRIDOR;

/** The hall with its own walls round it (west, north and south), as it stands outside. */
export const HALL_OUTER = {
  minX: CUBBY_HALL.minX - WALL_T,
  maxX: CUBBY_HALL.maxX,
  minZ: CUBBY_HALL.minZ - WALL_T,
  maxZ: CUBBY_HALL.maxZ + WALL_T,
} as const;

/**
 * The way in: a doorway through the old west wall into the corridor, between the north wall and the
 * first west window. A floor without cubbies has plain wall here, exactly as before.
 */
export const CUBBY_DOORWAY: Opening = { wall: 'west', u: -11.6, width: 1.4, y0: 0, y1: 2.4 };

/** One cubby as the hall places it (the shape of CubbyPlacement in features/cubbies/model.ts). */
export interface HallPlace {
  slot: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotY: number;
}

/** How wide each cubby is inside, along the hall. */
export const CUBBY_WIDTH = (CUBBY_HALL.maxZ - CUBBY_HALL.minZ - (HALL_SLOTS - 1) * HALL_PARTITION) / HALL_SLOTS;
/** How deep each cubby is inside, from its glass front back to the hall's outer wall. */
export const CUBBY_DEPTH = HALL_FRONT_X - CUBBY_HALL.minX;

/**
 * The four cubbies, slot 0 at the north end by the doorway: each one's middle, its size inside, and
 * which way it faces (rotY π/2: its front, +z in its own frame, faces +x, east, onto the corridor).
 */
export const HALL_PLACES: readonly HallPlace[] = Array.from({ length: HALL_SLOTS }, (_, slot) => ({
  slot,
  x: (CUBBY_HALL.minX + HALL_FRONT_X) / 2,
  z: CUBBY_HALL.minZ + CUBBY_WIDTH / 2 + slot * (CUBBY_WIDTH + HALL_PARTITION),
  width: CUBBY_WIDTH,
  depth: CUBBY_DEPTH,
  rotY: Math.PI / 2,
}));

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The hall's own walls: the outer west one and its north and south ends (each WALL_T thick). */
export function hallWalls(): { side: 'west' | 'north' | 'south'; box: Box }[] {
  const T = WALL_T;
  const h = CUBBY_HALL;
  return [
    { side: 'west', box: { minX: h.minX - T, maxX: h.minX, minZ: h.minZ - T, maxZ: h.maxZ + T } },
    { side: 'north', box: { minX: h.minX, maxX: h.maxX, minZ: h.minZ - T, maxZ: h.minZ } },
    { side: 'south', box: { minX: h.minX, maxX: h.maxX, minZ: h.maxZ, maxZ: h.maxZ + T } },
  ];
}

/** The partitions between neighbouring cubbies, from the outer wall to the glass fronts. */
export function hallPartitions(): Box[] {
  return HALL_PLACES.slice(1).map((p) => {
    const z = p.z - CUBBY_WIDTH / 2 - HALL_PARTITION / 2;
    return { minX: CUBBY_HALL.minX, maxX: HALL_FRONT_X, minZ: z - HALL_PARTITION / 2, maxZ: z + HALL_PARTITION / 2 };
  });
}

/** The doorway's hole through the old west wall, as a box. */
export function doorwayBox(): Box {
  const o = CUBBY_DOORWAY;
  return { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: o.u - o.width / 2, maxZ: o.u + o.width / 2 };
}

/** Is (x, z) in the hall (`m` in from its walls), or in the doorway through to it? */
export function inCubbyHall(x: number, z: number, m = 0): boolean {
  const h = CUBBY_HALL;
  if (x > h.minX + m && x < h.maxX && z > h.minZ + m && z < h.maxZ - m) return true;
  const d = doorwayBox();
  return x >= d.minX && x <= d.maxX && z > d.minZ && z < d.maxZ;
}

/** Just inside the open floor from the doorway: where anyone left in the hall goes when it closes. */
export const HALL_WAY_OUT = { x: FLOOR.minX + 0.6, z: CUBBY_DOORWAY.u } as const;

/** What the hall must keep clear of: the exit door's landing and its stairs, all the way down. */
export function exitStairsBox(): Box {
  const s = EXIT_STAIRS;
  return { minX: s.minX, maxX: s.maxX, minZ: Math.min(s.landingZ0, EXIT_DOOR.u - EXIT_DOOR.width / 2), maxZ: s.landingZ1 + s.steps * s.run };
}
