import * as THREE from 'three';
import { FLOOR, SLAB, WALL_HEIGHT, WALL_T } from '../../../shared/layout';
import { STUDIO_DOOR, STUDIO_DOOR_HALF, STUDIO_WING, STUDIO_WING_FLOOR, STUDIO_WING_ROOMS, type StudioRoom } from '../../../shared/studio-wing';
import type { NightParts } from '../outside';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box, glassPane } from './materials';
import { deskBooks, deskMug, coffeeTable, floorPlant, pendant, plant, pouf, wallBoard } from './props';
import { wallRun, wetPane, windowIn, type Door } from './shell';
import type { Looks } from './materials';

// The studio wing: a walk-in annex behind the office's north wall (see shared/studio-wing.ts). A
// hallway runs the width of the annex behind the wall, from a doorway in the gap between the
// task-queue board and the PR board, with three glass-walled studios off its north side: Marketing,
// Product and Development. The wing is set dressing — its signs open the floor's Departments panel
// (the existing directory's feature) rather than hiring anyone, and every existing seat stays where
// it is in the office. Built like the back office (wing.ts): planks carried through on their own
// slab, wallRun for the shell, the meeting room's glass-wall pattern for the studios.

const T = WALL_T;
const H = STUDIO_WING.height;
const S = STUDIO_WING;
const INK = '#2b2d42';
const CREAM = '#fffaf3';

/** A sliding pair of glass leaves at (x, z) across a `width`-wide doorway, opening for whoever comes up. */
function slidingDoor(width: number, h: number, x: number, z: number, doors: Door[]) {
  const half = width / 2;
  const alu = toon('#aab4be');
  const leaves: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group();
    for (const y of [0.04, h - 0.04]) leaf.add(mesh(box(half, 0.07, 0.04), alu, 0, y, 0, false));
    for (const lx of [-half / 2 + 0.03, half / 2 - 0.03]) leaf.add(mesh(box(0.06, h, 0.04), alu, lx, h / 2, 0, false));
    const pane = glassPane(half - 0.12, h - 0.14);
    pane.position.y = h / 2;
    leaf.add(pane);
    leaf.add(mesh(box(0.03, 0.4, 0.07), toon(INK), -side * (half / 2 - 0.1), 1.05, 0, false));
    const x0 = x + (side * half) / 2;
    leaf.position.set(x0, 0, z);
    leaves.push([leaf, x0]);
  }
  doors.push({
    x,
    y: 0,
    z,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [leaf, x0] of leaves) leaf.position.x = x0 + Math.sign(x0 - x) * e * (half - 0.06);
    },
  });
  return leaves.map(([leaf]) => leaf);
}

/** The doorway through the office's north wall: a white frame, sliding glass, and signs both sides. */
function buildEntrance(group: THREE.Group, doors: Door[]) {
  const frame = toon('#ffffff');
  const z = FLOOR.minZ - T / 2;
  group.add(mesh(box(STUDIO_DOOR.width + 0.16, 0.1, T + 0.08), frame, 0, STUDIO_DOOR.y1 + 0.05, z, false));
  for (const sx of [-1, 1]) group.add(mesh(box(0.1, STUDIO_DOOR.y1 + 0.1, T + 0.08), frame, sx * (STUDIO_DOOR.width / 2 + 0.03), (STUDIO_DOOR.y1 + 0.1) / 2, z, false));
  group.add(mesh(box(STUDIO_DOOR.width + 0.1, 0.03, T + 0.12), toon('#8d99ae'), 0, 0.015, z, false));
  for (const leaf of slidingDoor(STUDIO_DOOR.width, 2.3, 0, z + T / 2 + 0.04, doors)) group.add(leaf);
  // Over the doorway, on the office side, and a hanging sign inside the hallway facing both ways.
  const sign = textPlane('🎨 Studio Wing', { bg: INK, color: CREAM, size: 56, border: CREAM });
  sign.scale.multiplyScalar(0.62);
  sign.position.set(0, 2.78, z + T / 2 + 0.05);
  group.add(sign);
  for (const rot of [0, Math.PI]) {
    const way = textPlane('Studio Wing →', { bg: '#e07a5f', color: '#ffffff', size: 56, border: '#ffffff' });
    way.scale.multiplyScalar(0.55);
    way.position.set(0, 2.6, -14.15);
    way.rotation.y = rot;
    group.add(way);
  }
}

/** The studios' glass wall along `z` (with each doorway left open) and the partitions between them. */
function buildGlass(group: THREE.Group, colliders: Collider[], doors: Door[]) {
  const frameMat = toon('#ffffff');
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => group.add(mesh(box(w, h, d), frameMat, x, y, z, false));
  const run = (axis: 'x' | 'z', a: number, b: number, at: number) => {
    const len = b - a;
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i < n; i++) {
      const g = glassPane(len / n, H);
      const u = a + (i + 0.5) * (len / n);
      if (axis === 'x') g.position.set(u, H / 2, at);
      else {
        g.position.set(at, H / 2, u);
        g.rotation.y = Math.PI / 2;
      }
      group.add(g);
    }
    for (let i = 0; i <= n; i++) {
      const u = a + i * (len / n);
      if (axis === 'x') bar(0.08, H, 0.14, u, H / 2, at);
      else bar(0.14, H, 0.08, at, H / 2, u);
    }
    for (const y of [0.05, H - 0.05]) {
      if (axis === 'x') bar(len, 0.1, 0.16, (a + b) / 2, y, at);
      else bar(0.16, 0.1, len, at, y, (a + b) / 2);
    }
    colliders.push(axis === 'x' ? { minX: a, maxX: b, minZ: at - 0.05, maxZ: at + 0.05, top: H } : { minX: at - 0.05, maxX: at + 0.05, minZ: a, maxZ: b, top: H });
  };
  let u: number = S.minX;
  for (const room of STUDIO_WING_ROOMS) {
    run('x', u, room.doorX - STUDIO_DOOR_HALF, S.glassZ);
    run('x', room.doorX + STUDIO_DOOR_HALF, room.maxX, S.glassZ);
    bar(STUDIO_DOOR_HALF * 2, 0.1, 0.16, room.doorX, 2.3, S.glassZ);
    u = room.maxX;
  }
  for (const room of STUDIO_WING_ROOMS.slice(1)) run('z', S.backZ, S.glassZ, room.minX);
  for (const room of STUDIO_WING_ROOMS) {
    for (const leaf of slidingDoor(STUDIO_DOOR_HALF * 2, 2.25, room.doorX, S.glassZ + 0.09, doors)) group.add(leaf);
  }
}

/** A studio's sign over its doorway, facing the hallway; E beside it opens the Departments panel. */
function buildSign(group: THREE.Group, interactables: Interactable[], room: StudioRoom) {
  const label = textPlane(`${room.icon} ${room.name}`, { bg: INK, color: CREAM, size: 56, border: CREAM });
  label.scale.multiplyScalar(0.62);
  label.position.set(room.doorX, 2.62, S.glassZ + 0.14);
  group.add(label);
  const it: Interactable = { kind: 'departments', x: room.doorX, z: S.glassZ + 1.3, radius: 2 };
  interactables.push(it);
  label.userData.interact = it;
}

/** A framed canvas `w` by `h` on the studio's back wall, painted by `paint`. */
function backWallCanvas(room: StudioRoom, w: number, h: number, y: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Group {
  const { group, face } = wallBoard(w, h, room.color);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  paint(c.getContext('2d')!, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = face.material as THREE.MeshBasicMaterial;
  mat.map = tex;
  mat.needsUpdate = true;
  group.position.set((room.minX + room.maxX) / 2, y, S.backZ + 0.1);
  return group;
}

/** The marketing studio's moodboard: an easel with a canvas of swatches, pinned pages and a logotype. */
function paintMoodboard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = CREAM;
  g.fillRect(0, 0, w, h);
  const swatches = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#b388eb', '#ff8a5b'];
  swatches.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(24 + i * ((w - 48) / swatches.length), 30, (w - 48) / swatches.length - 10, 90);
  });
  g.fillStyle = INK;
  g.font = '800 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('LAUNCH 🚀', 24, 168);
  g.font = '600 26px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillStyle = '#5a5f6a';
  g.fillText('tone: warm, chunky, honest', 24, 226);
  g.fillText('audience: builders & their leads', 24, 266);
  for (const [x, y, c] of [
    [24, 330, '#bde0fe'],
    [190, 330, '#ffc6ff'],
    [356, 330, '#caffbf'],
  ] as const) {
    g.fillStyle = c;
    g.fillRect(x, y, 140, 110);
    g.fillStyle = INK;
    g.fillRect(x + 12, y + 14, 116, 8);
    g.fillRect(x + 12, y + 34, 80, 8);
  }
}

/** The product studio's planning board: three roadmap lanes with cards parked along them. */
function paintRoadmap(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#f4f1de';
  g.fillRect(0, 0, w, h);
  g.fillStyle = INK;
  g.font = '800 40px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('ROADMAP', 24, 52);
  const lanes = ['now', 'next', 'later'];
  lanes.forEach((lane, i) => {
    const y = 84 + i * ((h - 110) / lanes.length);
    g.fillStyle = ['#06d6a0', '#ffd166', '#8ecae6'][i];
    g.fillRect(24, y, w - 48, (h - 110) / lanes.length - 16);
    g.fillStyle = INK;
    g.font = '700 28px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(lane, 36, y + 36);
    const cards = 3 - (i === 2 ? 1 : 0);
    for (let k = 0; k < cards; k++) {
      g.fillStyle = CREAM;
      g.fillRect(130 + k * ((w - 200) / 3), y + 12, (w - 200) / 3 - 16, (h - 110) / lanes.length - 40);
      g.fillStyle = '#5a5f6a';
      g.fillRect(142 + k * ((w - 200) / 3), y + 24, (w - 200) / 3 - 40, 6);
      g.fillRect(142 + k * ((w - 200) / 3), y + 38, (w - 200) / 3 - 64, 6);
    }
  });
}

/** A little code editor screen for a workstation monitor. */
function screenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#22223b';
  g.fillRect(0, 0, 128, 80);
  const colors = ['#ef476f', '#06d6a0', '#ffd166', '#8ecae6', '#b388eb'];
  for (let row = 0; row < 9; row++) {
    g.fillStyle = colors[row % colors.length];
    g.fillRect(8 + (row % 3) * 10, 8 + row * 8, 30 + ((row * 37) % 70), 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The hallway's standing directory: the three studios, their colors and which way along the hall. */
function buildDirectory(group: THREE.Group, interactables: Interactable[]) {
  const x = 2.6;
  const z = -14.5;
  const wood = toon('#8a5a3b');
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 448;
  const g = c.getContext('2d')!;
  g.fillStyle = CREAM;
  g.fillRect(0, 0, 512, 448);
  g.strokeStyle = '#c9a227';
  g.lineWidth = 8;
  g.strokeRect(12, 12, 488, 424);
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.font = '900 52px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('Studio Wing', 256, 74);
  STUDIO_WING_ROOMS.forEach((room, i) => {
    const y = 140 + i * 96;
    g.fillStyle = room.color;
    g.fillRect(40, y - 34, 44, 44);
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.font = '800 38px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(room.name, 104, y);
    g.fillStyle = '#8a8f98';
    g.font = '600 26px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(`${room.icon} ${room.doorX < 0 ? '← down the hall, west' : room.doorX > 0 ? 'east, down the hall →' : 'straight in, middle'}`, 104, y + 34);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Group();
  board.position.set(x, 0, z);
  board.rotation.y = -Math.PI / 2;
  const panel = mesh(roundedBox(1.5, 0.07, 1.3, 0.05), wood, 0, 1.06, 0);
  panel.rotation.x = Math.PI / 2;
  board.add(panel);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 1.06, 0.045);
  board.add(face);
  for (const sx of [-0.62, 0.62]) {
    board.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8), wood, sx, 0.7, -0.02));
    board.add(mesh(roundedBox(0.28, 0.05, 0.4, 0.02), wood, sx, 0.025, 0));
  }
  group.add(board);
  const it: Interactable = { kind: 'departments', x: x - 1.2, z, radius: 1.8 };
  interactables.push(it);
  board.userData.interact = it;
}

/** One studio's dressing: rug, plants and the props that make it read as its discipline. */
function dressStudio(group: THREE.Group, colliders: Collider[], room: StudioRoom) {
  const midX = (room.minX + room.maxX) / 2;
  const rug = mesh(roundedBox(room.maxX - room.minX - 2.4, 0.02, 3.2, 0.5), toon(PALETTE.rugs[STUDIO_WING_ROOMS.indexOf(room) % PALETTE.rugs.length]), midX, 0.011, -19.2, false);
  group.add(rug);
  const prop = (r: readonly [number, number, number, number], top: number) => colliders.push({ minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top });
  if (room.preset === 'marketing') {
    // The moodboard easel, facing into the room.
    const easel = new THREE.Group();
    const board = mesh(roundedBox(1.25, 0.05, 1.0, 0.04), toon(CREAM), 0, 1.15, 0);
    board.rotation.x = -0.12;
    easel.add(board);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 410;
    paintMoodboard(c.getContext('2d')!, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.92), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(0, 1.16, 0.031);
    face.rotation.x = -0.12;
    easel.add(face);
    for (const sx of [-0.5, 0.5]) easel.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.7, 6), toon('#8a5a3b'), sx, 0.85, -0.06));
    easel.add(mesh(box(0.9, 0.05, 0.08), toon('#8a5a3b'), 0, 0.42, 0.12, false));
    easel.position.set(-10.55, 0, -19.75);
    easel.rotation.y = Math.PI / 2;
    group.add(easel);
    prop([-10.9, -10.2, -20.3, -19.2], 1.7);
    // The table with its poufs, and the prop shelf under the window.
    const table = coffeeTable();
    table.position.set(-8.4, 0, -20.55);
    group.add(table);
    for (const [px, pz, color] of [
      [-8.4, -19.9, '#ef476f'],
      [-7.9, -21.0, '#ffd166'],
    ] as const) {
      const p = pouf(color);
      p.position.set(px, 0, pz);
      group.add(p);
    }
    prop([-8.9, -7.9, -21.0, -20.1], 0.5);
    const shelf = new THREE.Group();
    shelf.add(mesh(box(1.2, 0.06, 0.34), toon(PALETTE.wood), 0, 0.92, 0));
    shelf.add(mesh(box(1.2, 0.06, 0.34), toon(PALETTE.wood), 0, 0.45, 0));
    for (const sx of [-0.55, 0.55]) shelf.add(mesh(box(0.06, 1.0, 0.3), toon('#8a5a3b'), sx, 0.5, 0));
    const books = deskBooks(1);
    books.position.set(-0.25, 0.95, 0);
    shelf.add(books);
    const books2 = deskBooks(2);
    books2.position.set(0.3, 0.48, 0);
    shelf.add(books2);
    shelf.position.set(-6.1, 0, -21.1);
    group.add(shelf);
    prop([-6.7, -5.5, -21.35, -20.85], 1.0);
  } else if (room.preset === 'product') {
    group.add(backWallCanvas(room, 3.6, 2.0, 1.85, paintRoadmap));
    const table = new THREE.Group();
    table.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 24), toon(PALETTE.wood), 0, 0.74, 0));
    table.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 10), toon(PALETTE.deskLeg), 0, 0.37, 0));
    table.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.05, 20), toon(PALETTE.deskLeg), 0, 0.03, 0));
    const noteColors = ['#ef476f', '#ffd166', '#06d6a0', '#8ecae6', '#b388eb', '#ff8a5b'];
    noteColors.forEach((c, i) => {
      const a = (i / noteColors.length) * Math.PI * 2;
      table.add(mesh(box(0.14, 0.012, 0.14), toon(c), Math.cos(a) * 0.5, 0.78, Math.sin(a) * 0.5, false));
    });
    table.position.set(0, 0, -19.8);
    group.add(table);
    prop([-0.9, 0.9, -20.3, -19.3], 0.8);
  } else {
    // Development: a bench of workstations along the back wall, and a rack with cable spools.
    const bench = new THREE.Group();
    bench.add(mesh(roundedBox(4.6, 0.07, 0.75, 0.04), toon(PALETTE.wood), 0, 0.74, 0));
    for (const sx of [-2.1, -0.7, 0.7, 2.1]) bench.add(mesh(box(0.08, 0.72, 0.6), toon(PALETTE.deskLeg), sx, 0.37, 0));
    const screen = screenTexture();
    for (const [mx, i] of [
      [-1.5, 0],
      [0, 1],
      [1.5, 2],
    ] as const) {
      bench.add(mesh(box(0.08, 0.3, 0.08), toon(INK), mx, 0.9, -0.18, false));
      const monitor = mesh(box(0.62, 0.4, 0.05), toon(INK), mx, 1.2, -0.18, false);
      bench.add(monitor);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.34), new THREE.MeshBasicMaterial({ map: screen }));
      face.position.set(mx, 1.2, -0.15);
      face.rotation.y = 0;
      bench.add(face);
      const mug = deskMug(PALETTE.chairs[i % PALETTE.chairs.length]);
      mug.position.set(mx + 0.45, 0.78, 0.12);
      bench.add(mug);
    }
    const stack = deskBooks(0);
    stack.position.set(-2.0, 0.78, 0.1);
    bench.add(stack);
    bench.position.set(7.2, 0, -20.95);
    group.add(bench);
    prop([4.7, 9.7, -21.4, -20.5], 1.4);
    const rack = new THREE.Group();
    rack.add(mesh(roundedBox(0.6, 1.4, 0.9, 0.04), toon('#3d405b'), 0, 0.7, 0));
    for (let row = 0; row < 5; row++)
      for (let k = 0; k < 3; k++) rack.add(mesh(box(0.06, 0.06, 0.02), toon('#fff7d6', { emissive: ['#06d6a0', '#ef476f', '#8ecae6'][(row + k) % 3] }), -0.18 + k * 0.18, 0.32 + row * 0.22, 0.46, false));
    rack.position.set(10.65, 0, -19.4);
    group.add(rack);
    prop([10.3, 11.0, -19.9, -18.9], 1.4);
    for (const [sx, sz] of [
      [10.15, -18.7],
      [9.95, -18.55],
    ] as const) {
      const spool = new THREE.Group();
      spool.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 14), toon('#8a5a3b'), 0, 0.15, 0));
      spool.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), toon(PALETTE.wood), 0, 0.3, 0));
      spool.position.set(sx, 0, sz);
      group.add(spool);
    }
    prop([9.9, 10.4, -19.0, -18.4], 0.35);
  }
  // The corner plant every studio gets.
  const potted = plant(floorPlant(STUDIO_WING_ROOMS.indexOf(room)), 1.05);
  potted.position.set(room.plant[0], 0, room.plant[1]);
  group.add(potted);
  prop([room.plant[0] - 0.2, room.plant[0] + 0.2, room.plant[1] - 0.2, room.plant[1] + 0.2], 0.9);
}

/** The studio wing: hallway, studios, signs, and the props that dress them. */
export function buildStudioWing(group: THREE.Group, colliders: Collider[], interactables: Interactable[], doors: Door[], looks: Looks, planks: THREE.Material, ceiling: THREE.Material, night: NightParts) {
  const w = S.maxX - S.minX;
  const d = S.frontZ - S.backZ;
  const midZ = (S.frontZ + S.backZ) / 2;

  // The floor: the room's planks carried on through, on a slab like the room's.
  const floorGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, 0, midZ);
  const uv = floorGeo.getAttribute('uv');
  const pos = floorGeo.getAttribute('position');
  for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX), (FLOOR.maxZ - pos.getZ(k)) / (FLOOR.maxZ - FLOOR.minZ));
  const floor = new THREE.Mesh(floorGeo, planks);
  floor.receiveShadow = true;
  group.add(floor);
  const band = toon('#e8a87c');
  const concrete = toon('#d3d6dd');
  const slab = new THREE.Mesh(box(w + 2 * T, SLAB - 0.01, d), [band, band, concrete, concrete, band, band]);
  slab.position.set(0, -SLAB / 2 - 0.005, midZ - T / 2);
  slab.receiveShadow = true;
  group.add(slab);
  const ceilGeo = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(0, H, midZ);
  const cuv = ceilGeo.getAttribute('uv');
  const cpos = ceilGeo.getAttribute('position');
  for (let k = 0; k < cpos.count; k++) cuv.setXY(k, cpos.getX(k), cpos.getZ(k));
  const ceil = new THREE.Mesh(ceilGeo, ceiling);
  ceil.name = 'studioWingCeiling';
  group.add(ceil);
  // Its roof, flush with the tops of its walls, for there's no floor over it.
  const roof = mesh(box(w + 2 * T, 0.02, d + T), toon(CREAM), 0, H + 0.03, midZ - T / 2, false);
  roof.name = 'studioWingRoof';
  group.add(roof);
  // The floor: a slab like the room's, so ground under you doesn't run out at the wall (see
  // STUDIO_WING_FLOOR); and the roof's, so nobody hops onto it from a friend's shoulders.
  colliders.push({ ...STUDIO_WING_FLOOR });
  colliders.push({ minX: S.minX - T, maxX: S.maxX + T, minZ: S.backZ - T, maxZ: S.frontZ, bottom: H, top: H + SLAB });

  // The shell: west and east walls, and the back wall with a window into each studio.
  wallRun(group, colliders, 'z', S.minX - T / 2, S.backZ - T, S.frontZ, -1, [], looks, [false, false]);
  wallRun(group, colliders, 'z', S.maxX + T / 2, S.backZ - T, S.frontZ, 1, [], looks, [false, false]);
  const backWindows = STUDIO_WING_ROOMS.map((room) => ({ wall: 'north' as const, u: room.doorX, width: 2.4, y0: room.windowY[0], y1: room.windowY[1] }));
  wallRun(group, colliders, 'x', S.backZ - T / 2, S.minX - T, S.maxX + T, -1, backWindows, looks, [false, false]);
  for (const o of backWindows) {
    const win = windowIn(o);
    win.position.z = S.backZ - T / 2;
    group.add(win);
    const wet = wetPane(o, night.wetGlass);
    wet.position.z = S.backZ - T / 2;
    group.add(wet);
  }

  buildEntrance(group, doors);
  buildGlass(group, colliders, doors);
  for (const room of STUDIO_WING_ROOMS) buildSign(group, interactables, room);
  buildDirectory(group, interactables);

  // The hallway: a runner rug and a lamp over each studio door.
  group.add(mesh(roundedBox(9, 0.02, 1.6, 0.5), toon(PALETTE.rugs[3]), 0, 0.011, -14.6, false));
  for (const x of [-7.5, 0, 7.5]) {
    const lamp = pendant(H - 4.05);
    lamp.position.set(x, 4.05, -14.6);
    group.add(lamp);
  }
  for (const room of STUDIO_WING_ROOMS) {
    const lamp = pendant(H - 4.05);
    lamp.position.set(room.doorX, 4.05, -19);
    group.add(lamp);
  }
  for (const room of STUDIO_WING_ROOMS) dressStudio(group, colliders, room);
}

/** The studio wing annex behind the north wall: hallway, three glass studios, and their signs. */
export const studioWing: Fixture = (site) => {
  const night = site.get('night');
  buildStudioWing(site.group, site.colliders, site.interactables, site.doors, site.looks, site.planks, site.get('stack').ceiling, night);
  site.wall('north', STUDIO_DOOR.u, STUDIO_DOOR.y1 / 2, STUDIO_DOOR.width + 0.2, STUDIO_DOOR.y1 + 0.1);
  return {};
};
