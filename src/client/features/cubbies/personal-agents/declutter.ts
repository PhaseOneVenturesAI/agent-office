// Keeps personal agents' nameplates readable when agents stand close together or one is behind
// another: each plate stays over its own agent's head, and a plate that would cover a nearer
// agent's plate on screen is lifted, a step at a time, until it doesn't (Jonathan, 2026-11-26).
import * as THREE from 'three';

/** How far a plate is lifted per step, and how many steps it may take. */
export const LIFT = 0.34;
export const MAX_STEPS = 3;

export interface Plate { sprite: THREE.Sprite; base: number }
export interface ScreenBox { minX: number; maxX: number; minY: number; maxY: number }

const corner = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), centre = new THREE.Vector3();

/** Where `sprite` lands on screen, in normalised device coordinates (-1..1). */
export function screenBox(sprite: THREE.Sprite, camera: THREE.Camera): ScreenBox {
  camera.updateMatrixWorld();
  sprite.updateWorldMatrix(true, false);
  sprite.getWorldPosition(centre);
  const scale = new THREE.Vector3(); sprite.getWorldScale(scale);
  right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(scale.x / 2);
  up.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(scale.y / 2);
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    corner.copy(centre).addScaledVector(right, a).addScaledVector(up, b).project(camera);
    box.minX = Math.min(box.minX, corner.x); box.maxX = Math.max(box.maxX, corner.x);
    box.minY = Math.min(box.minY, corner.y); box.maxY = Math.max(box.maxY, corner.y);
  }
  return box;
}

export const overlaps = (a: ScreenBox, b: ScreenBox) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Nearest plate keeps its place; each farther one rises over its own agent until it's clear. */
export function declutter(plates: Plate[], camera: THREE.Camera): void {
  const at = new THREE.Vector3();
  camera.updateMatrixWorld();
  const from = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const order = plates.map((p) => {
    p.sprite.position.y = p.base;
    p.sprite.updateWorldMatrix(true, false);
    return { p, d: p.sprite.getWorldPosition(at).distanceToSquared(from) };
  }).sort((a, b) => a.d - b.d);
  const placed: ScreenBox[] = [];
  for (const { p } of order) {
    let box = screenBox(p.sprite, camera);
    for (let step = 1; step <= MAX_STEPS && placed.some((q) => overlaps(box, q)); step++) {
      p.sprite.position.y = p.base + step * LIFT;
      box = screenBox(p.sprite, camera);
    }
    placed.push(box);
  }
}
