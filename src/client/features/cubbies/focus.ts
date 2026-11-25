// Whose name tag and task card show where helpers sit close together (a cubby, a draft floor's
// uncovered pod): only the one you're aiming at, else the nearest one roughly in front of you that you're
// standing right by. Never more than one, so their labels can't pile up over each other or the boards.

import type * as THREE from 'three';

/** Where you are, and what you're aiming at, for deciding whose name tag shows. */
export interface Focus { x: number; z: number; aimed: unknown; /** Which way you're looking (0 is -z, π/2 is -x). */ yaw: number }

/** How far round from straight ahead a helper can be for its tag to show without aiming (cos 30°). */
export const IN_FRONT = Math.cos(Math.PI / 6);
/** How close you stand to a helper for its tag to show without aiming at it. */
export const NEAR = 1.1;

/** One helper that might show its tags: where it is on the floor, and what aiming at it lands on. */
export interface Tagged<T> { item: T; x: number; z: number; interact?: unknown }

/** The one of `items` whose tags show for `focus`, if any (see the top of this file). */
export function focusedOf<T>(items: Iterable<Tagged<T>>, focus?: Focus): T | undefined {
  if (!focus) return undefined;
  let best: T | undefined;
  let bestD = NEAR;
  for (const c of items) {
    if (focus.aimed && c.interact && focus.aimed === c.interact) return c.item;
    const dx = c.x - focus.x;
    const dz = c.z - focus.z;
    const d = Math.hypot(dx, dz);
    // Only one roughly in front of you: one off to the side would put its tag half off the screen.
    const ahead = d > 0 && (-Math.sin(focus.yaw) * dx - Math.cos(focus.yaw) * dz) / d > IN_FRONT;
    if (ahead && d < bestD) {
      best = c.item;
      bestD = d;
    }
  }
  return best;
}

/** The layer a hidden tag is drawn on: no camera looks at it. */
const HIDDEN_LAYER = 31;
/** Shows (or hides) every label a character draws: its name tag, task card and the rest of its sprites. */
export function showTags(root: THREE.Object3D, show: boolean) {
  root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) o.layers.set(show ? 0 : HIDDEN_LAYER);
  });
}
