import * as THREE from 'three';
import { FLOOR, WALL_HEIGHT, WALL_T, WING, wingMinZ } from '../../shared/layout';
import { HALL_OUTER } from '../../shared/cubbyhall';

export const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
export const skyWing = { value: new THREE.Vector4(1, 0, 1, 0) };
export const skyHall = { value: new THREE.Vector4(1, 0, 1, 0) };
let hallOpen = false;
/** The back office, walls included, when the floor you're on is built out into one (see Sky.setWing). */
let wingBox: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

/** Is (x, z) under the building, where no rain or snow falls? */
export const buildingSheltered = (x: number, z: number) =>
  (x > B.minX - 0.05 && x < B.maxX + 0.05 && z > B.minZ - 0.05 && z < B.maxZ + 0.05) || (!!wingBox && x > wingBox.minX - 0.05 && x < wingBox.maxX + 0.05 && z > wingBox.minZ - 0.05 && z < wingBox.maxZ);
export const sheltered = (x: number, z: number) => buildingSheltered(x, z) || hallSheltered(x, z);

export function hallSheltered(x: number, z: number): boolean {
  return hallOpen && x >= HALL_OUTER.minX && x <= HALL_OUTER.maxX && z >= HALL_OUTER.minZ && z <= HALL_OUTER.maxZ;
}
export function hallIndoors(p: { x: number; y: number; z: number }): boolean {
  return hallSheltered(p.x, p.z) && p.y >= -0.06 && p.y < WALL_HEIGHT + 0.005;
}
export function setHall(on: boolean) {
  hallOpen = on;
  if (on) skyHall.value.set(HALL_OUTER.minX, HALL_OUTER.maxX, HALL_OUTER.minZ, HALL_OUTER.maxZ);
  else skyHall.value.set(1, 0, 1, 0);
}
export function setWing(level: number) {
  const minZ = wingMinZ(level);
  wingBox = level > 0 ? { minX: WING.minX - WALL_T, maxX: WING.maxX + WALL_T, minZ: minZ - WALL_T, maxZ: FLOOR.minZ } : null;
  if (level > 0) skyWing.value.set(WING.minX - 0.02, WING.maxX + 0.02, minZ - 0.02, FLOOR.minZ);
  else skyWing.value.set(1, 0, 1, 0);
}
const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`;
export const officeMask = /* glsl */ `
// Inside the office's walls (and up through its open top), or the back office's, up to its ceiling
// and no further: its roof, and the cornice over where the wall came down, are outdoors.
float skyInOffice( vec3 p ) {
  vec3 d = max( ${v3(FLOOR.minX - 0.02, -0.06, FLOOR.minZ - 0.02)} - p, p - ${v3(FLOOR.maxX + 0.02, 40, FLOOR.maxZ + 0.02)} );
  vec3 w = max( vec3( skyWing.x, -0.06, skyWing.z ) - p, p - vec3( skyWing.y, ${(WALL_HEIGHT + 0.005).toFixed(3)}, skyWing.w ) );
  float wing = length( max( w, 0.0 ) ) + step( ${(WALL_HEIGHT + 0.005).toFixed(3)}, p.y );
  vec3 h = max( vec3( skyHall.x, -0.06, skyHall.z ) - p, p - vec3( skyHall.y, ${(WALL_HEIGHT + 0.005).toFixed(3)}, skyHall.w ) );
  float hall = length( max( h, 0.0 ) ) + step( ${(WALL_HEIGHT + 0.005).toFixed(3)}, p.y );
  return 1.0 - smoothstep( 0.0, 0.12, min( length( max( d, 0.0 ) ), min(wing, hall) ) );
}

`;
