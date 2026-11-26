// Keeps personal agents' nameplates readable and unambiguous when agents stand close together or
// one is behind another (Jonathan, 2026-11-26). The nearest agent's plate stays over its own head.
// A farther plate moves, sideways toward its own agent and then up, until it covers neither a
// nearer plate nor any other agent's head on screen, always keeping its own head under it. If no
// such spot exists, it stays put and is dimmed, so it reads as behind.
import * as THREE from 'three';

/** How far a plate may step sideways and up (metres), and how many steps of each. */
export const SHIFT = 0.15;
export const LIFT = 0.3;
export const STEPS = 3;
/** Opacity of a plate that couldn't find a clear spot. */
export const DIMMED = 0.55;

export interface Plate { sprite: THREE.Sprite; base: THREE.Vector3; owner: THREE.Object3D }
export interface ScreenBox { minX: number; maxX: number; minY: number; maxY: number }

const v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();

function boxOf(centre: THREE.Vector3, halfW: number, halfH: number, camera: THREE.Camera): ScreenBox {
  right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(halfW);
  up.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(halfH);
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    v.copy(centre).addScaledVector(right, a).addScaledVector(up, b).project(camera);
    box.minX = Math.min(box.minX, v.x); box.maxX = Math.max(box.maxX, v.x);
    box.minY = Math.min(box.minY, v.y); box.maxY = Math.max(box.maxY, v.y);
  }
  return box;
}

/** Where `sprite` lands on screen, in normalised device coordinates (-1..1). */
export function screenBox(sprite: THREE.Sprite, camera: THREE.Camera): ScreenBox {
  sprite.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3(); sprite.getWorldScale(scale);
  return boxOf(sprite.getWorldPosition(new THREE.Vector3()), scale.x / 2, scale.y / 2, camera);
}

/** The agent's head on screen: the top of its body (meshes only, not its plate or floor ring). */
export function headBox(root: THREE.Object3D, camera: THREE.Camera): ScreenBox {
  const body = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh && o.name !== 'owner-ring') body.expandByObject(o, true);
  });
  if (body.isEmpty()) return boxOf(root.getWorldPosition(new THREE.Vector3()), 0, 0, camera);
  const centre = body.getCenter(new THREE.Vector3()).setY(body.max.y - 0.2);
  return boxOf(centre, 0.2, 0.2, camera);
}

export const overlaps = (a: ScreenBox, b: ScreenBox) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const holds = (plate: ScreenBox, head: ScreenBox) => plate.minX <= (head.minX + head.maxX) / 2 && (head.minX + head.maxX) / 2 <= plate.maxX;

/** Place every plate; `agents` are all the agents in the room, whether their plates show or not. */
export function declutter(plates: Plate[], agents: THREE.Object3D[], camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  const from = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const heads = new Map(agents.map((a) => [a, headBox(a, camera)] as const));
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const order = plates.map((p) => ({ p, d: p.owner.getWorldPosition(new THREE.Vector3()).distanceToSquared(from) })).sort((a, b) => a.d - b.d);
  const placed: ScreenBox[] = [];
  const at = new THREE.Vector3();
  const put = (p: Plate, shift: number, lift: number) => {
    const parent = p.sprite.parent!;
    parent.updateWorldMatrix(true, false);
    at.copy(p.base); parent.localToWorld(at);
    at.addScaledVector(camRight, shift); at.y += lift;
    p.sprite.position.copy(parent.worldToLocal(at));
    return screenBox(p.sprite, camera);
  };
  for (const { p } of order) {
    const own = heads.get(p.owner) ?? headBox(p.owner, camera);
    const others = [...heads].filter(([a]) => a !== p.owner).map(([, h]) => h);
    const clear = (b: ScreenBox) => holds(b, own) && !placed.some((q) => overlaps(b, q)) && !others.some((h) => overlaps(b, h));
    // Sideways toward its own head first (away from whatever it covers), then up as well.
    let best: ScreenBox | undefined;
    const base = put(p, 0, 0);
    const blocker = others.find((h) => overlaps(base, h));
    const side = blocker ? Math.sign((own.minX + own.maxX) - (blocker.minX + blocker.maxX)) || -1 : 1;
    search: for (let lift = 0; lift <= STEPS; lift++) {
      for (let s = 0; s <= STEPS; s++) {
        const b = put(p, side * s * SHIFT, lift * LIFT);
        if (clear(b)) { best = b; break search; }
      }
    }
    p.sprite.material.opacity = best ? 1 : DIMMED;
    placed.push(best ?? put(p, 0, 0));
  }
}
