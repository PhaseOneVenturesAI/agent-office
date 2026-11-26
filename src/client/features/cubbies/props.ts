// The cubby's furniture: the builders' desk with its two chairs, bean bags, the factory machine with its
// clock, a Paradev wall screen, the status lamp, the frosted front and the shapes moving behind it. The
// geometry and materials are made once and shared by every cubby; only the few canvases with words on
// them are a cubby's own, and they're redrawn only when the words change.

import * as THREE from 'three';
import { chair } from '../../world/office/seats';
import { glassPane, PALETTE } from '../../world/office/materials';
import { mesh, roundedBox, toon } from '../../world/toon';
import { LAMP_COLOR } from './model';

const INK = '#2b2d42';
const CREAM = '#fffaf3';

/** Every geometry made here, which disposing a cubby leaves alone. */
const SHARED_GEOMETRY = new Set<THREE.BufferGeometry>();
const made = new Map<string, THREE.BufferGeometry>();
/** Shared geometry, made the first time it's wanted. */
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = made.get(key);
  if (!g) {
    made.set(key, (g = make()));
    SHARED_GEOMETRY.add(g);
  }
  return g;
}

/** A material that's shared, but marked so disposing a cubby doesn't free it. */
const shared = <M extends THREE.Material>(m: M): M => {
  m.userData.shared = true;
  return m;
};
const FROST = shared(new THREE.MeshBasicMaterial({ color: '#f4f7fb', transparent: true, opacity: 0.86, depthWrite: false, side: THREE.DoubleSide }));
const SHADOW = shared(new THREE.MeshBasicMaterial({ color: '#9aa3ad', transparent: true, opacity: 0.55, depthWrite: false }));
const LAMPS = Object.fromEntries(Object.entries(LAMP_COLOR).map(([k, c]) => [k, shared(toon(c, { emissive: new THREE.Color(c).multiplyScalar(0.55).getStyle() }))])) as Record<keyof typeof LAMP_COLOR, THREE.MeshToonMaterial>;

/** A simple writing desk: top and four legs, `w` by `d`, in the office's desk wood. */
export function simpleDesk(w: number, d: number, h = 0.78): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo(`top${w}x${d}`, () => roundedBox(w, 0.08, d, 0.06)), toon(PALETTE.desk), 0, h - 0.04, 0));
  const legs = toon('#8d99ae');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(geo(`leg${h}`, () => new THREE.CylinderGeometry(0.035, 0.035, h - 0.08, 8)), legs, sx * (w / 2 - 0.1), (h - 0.08) / 2, sz * (d / 2 - 0.1)));
  return g;
}

/** The builders' desk: one desk, two chairs on its +z side, a worker's anchor in each (facing the desk). */
export function builderDesk(): { group: THREE.Group; seats: THREE.Object3D[] } {
  const group = simpleDesk(1.8, 0.8);
  const seats: THREE.Object3D[] = [];
  for (const [i, dx] of [-0.45, 0.45].entries()) {
    const ch = chair(PALETTE.chairs[(i + 2) % PALETTE.chairs.length]);
    ch.position.set(dx, 0, 0.75);
    ch.scale.setScalar(0.85);
    group.add(ch);
    const seat = new THREE.Object3D();
    seat.position.set(dx, 0.36, 0.78);
    seat.rotation.y = Math.PI;
    seat.scale.setScalar(0.82);
    group.add(seat);
    seats.push(seat);
  }
  return { group, seats };
}

const BAG_COLORS = ['#9b5de5', '#4ecdc4', '#f15bb5', '#ffd166'];

/** A squashy bean bag, with where its worker sits sunk into it (facing +z). */
export function beanbag(i: number): { group: THREE.Group; seat: THREE.Object3D } {
  const group = new THREE.Group();
  const cloth = toon(BAG_COLORS[i % BAG_COLORS.length]);
  const bag = mesh(geo('bag', () => new THREE.SphereGeometry(0.5, 18, 12)), cloth, 0, 0.24, 0);
  bag.scale.set(1, 0.5, 1);
  group.add(bag);
  const back = mesh(geo('bagBack', () => new THREE.SphereGeometry(0.4, 16, 10)), cloth, 0, 0.48, -0.26);
  back.scale.set(1.05, 0.95, 0.7);
  group.add(back);
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.26, 0.02);
  seat.scale.setScalar(0.82);
  group.add(seat);
  return { group, seat };
}

/** A little canvas face whose words are redrawn only when they change. */
export class Face {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor(
    w: number,
    h: number,
    private px = 256,
  ) {
    this.canvas.width = px;
    this.canvas.height = Math.round((px * h) / w);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex }));
  }

  /** Draws `paint` once per distinct `key`. */
  draw(key: string, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (key === this.key) return;
    this.key = key;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    paint(c, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export const FONT = (size: number, weight = 800) => `${weight} ${size}px Nunito, ui-rounded, system-ui, sans-serif`;

/** Text in a box, cut with an ellipsis to fit `maxW`. */
export function fitText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  let t = text;
  while (t.length > 1 && c.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
  c.fillText(t, x, y);
}

/** The factory machine: a cabinet with a progress window and a clock face showing its deadline. Front is +z. */
export function factoryMachine(): { group: THREE.Group; face: Face } {
  const group = new THREE.Group();
  group.add(mesh(geo('fact', () => roundedBox(0.7, 1.15, 0.6, 0.08)), toon('#8d99ae'), 0, 0.575, 0));
  group.add(mesh(geo('factTop', () => roundedBox(0.76, 0.08, 0.66, 0.05)), toon(INK), 0, 1.19, 0));
  const face = new Face(0.56, 0.5, 192);
  face.mesh.position.set(0, 0.78, 0.31);
  group.add(face.mesh);
  // A chimney with a puff of steam on top, so it reads as a machine from the door.
  group.add(mesh(geo('chim', () => new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8)), toon(INK), 0.22, 1.36, -0.12));
  return { group, face };
}

/** A Paradev wall screen: a dark bezel with its face. Front is +z. */
export function wallScreen(): { group: THREE.Group; face: Face } {
  const group = new THREE.Group();
  group.add(mesh(geo('bezel', () => roundedBox(1.0, 0.05, 0.62, 0.04).rotateX(Math.PI / 2)), toon(INK), 0, 0, 0));
  const face = new Face(0.92, 0.54, 320);
  face.mesh.position.z = 0.03;
  group.add(face.mesh);
  return { group, face };
}

/** A small lamp dot for the outside sign, in the cubby's color. */
export function lampDot(): { mesh: THREE.Mesh; set(state: keyof typeof LAMP_COLOR | null): void } {
  const dot = mesh(geo('dot', () => new THREE.SphereGeometry(0.11, 14, 10)), LAMPS.asleep, 0, 0, 0, false);
  return { mesh: dot, set: (s) => ((dot.visible = !!s), s && (dot.material = LAMPS[s])) };
}

/**
 * A run of front glass `w` wide with a doorway `door` wide in the middle (none when `door` is 0):
 * clear for your own cubby, frosted for anyone else's. Front is +z.
 */
export function front(w: number, h: number, door: number, frosted: boolean): THREE.Group {
  const g = new THREE.Group();
  const side = (w - door) / 2;
  const frame = toon(PALETTE.wood);
  const pane = (pw: number, x: number) => {
    if (pw <= 0.02) return;
    if (frosted) g.add(mesh(geo(`frost${pw.toFixed(2)}x${h}`, () => new THREE.PlaneGeometry(pw, h)), FROST, x, h / 2, 0, false));
    else {
      const glass = glassPane(pw, h);
      glass.position.set(x, h / 2, 0);
      g.add(glass);
    }
  };
  if (door > 0) {
    pane(side, -w / 2 + side / 2);
    pane(side, w / 2 - side / 2);
    for (const sx of [-1, 1]) g.add(mesh(geo(`post${h}`, () => new THREE.BoxGeometry(0.08, h, 0.1)), frame, sx * (door / 2), h / 2, 0));
  } else pane(w, 0);
  for (const sx of [-1, 1]) g.add(mesh(geo(`post${h}`, () => new THREE.BoxGeometry(0.08, h, 0.1)), frame, sx * (w / 2), h / 2, 0));
  g.add(mesh(geo(`lintel${w}`, () => new THREE.BoxGeometry(w + 0.08, 0.1, 0.12)), frame, 0, h + 0.05, 0));
  return g;
}

/** A soft grey shape behind frosted glass: someone's there, never who or what. */
export function silhouette(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo('silBody', () => new THREE.CapsuleGeometry(0.24, 0.5, 4, 10)), SHADOW, 0, 0.6, 0, false));
  g.add(mesh(geo('silHead', () => new THREE.SphereGeometry(0.2, 12, 8)), SHADOW, 0, 1.25, 0, false));
  return g;
}

/** Frees a cubby's own geometry and materials, leaving the shared ones. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
    // Every sprite shares three.js's one quad, so only a mesh's geometry is its own to free.
    if (m.isMesh && m.geometry && !SHARED_GEOMETRY.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat || mat.userData.shared) continue;
      // The toon cache's materials are everyone's; only a canvas's are a cubby's own.
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map instanceof THREE.CanvasTexture) {
        map.dispose();
        mat.dispose();
      }
    }
  });
}

export { CREAM, INK };
