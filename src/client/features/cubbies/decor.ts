// Public, deterministic furnishings, never derived from private owner/agent data.
import * as THREE from 'three';
import { deskBooks, deskMug, plant } from '../../world/office/props';
import { box, PALETTE } from '../../world/office/materials';
import { ownBulbs } from '../../world/office/interior-lights';
import { mesh, roundedBox, toon } from '../../world/toon';
import { furniture, type CubbyPlacement } from './model';
import { simpleDesk } from './props';

/** Cubby disposal must leave the cached office model's geometry intact. */
function ownModel<T extends THREE.Object3D>(root: T): T {
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry = m.geometry.clone(); });
  return root;
}
const ACCENTS = ['#8ecae6', '#cdb4db', '#a7d98b', '#ffd166'];
export function cubbyDecor(place: CubbyPlacement) {
  const { width: w, depth: d, slot } = place;
  const f = furniture(w, d), group = new THREE.Group();
  const color = ACCENTS[slot % ACCENTS.length];
  group.name = `cubby-decor-${slot}`;
  const rug = mesh(roundedBox(w - 0.65, 0.018, d - 0.9, 0.18), toon(color), 0, 0.014, 0, false);
  group.add(rug);
  for (let i = 0; i <= slot; i++) group.add(mesh(box(0.045, 0.005, d - 1.1), toon('#fffaf3'), -w / 2 + 0.48 + i * 0.11, 0.026, 0, false));
  const pot = ownModel(plant(slot % 2 ? 'snake_plant' : 'monstera', 0.48));
  pot.position.set(w / 2 - 0.35, 0, -d / 2 + 1.55);
  group.add(pot);
  // Shelf and framed geometric print on the right partition, away from the west window.
  const shelf = mesh(box(0.26, 0.07, 1.25), toon(PALETTE.wood), w / 2 - 0.16, 1.65, 0.25, false);
  group.add(shelf);
  const books = ownModel(deskBooks(slot));
  books.position.set(w / 2 - 0.19, 1.69, 0.15);
  books.rotation.y = -Math.PI / 2;
  group.add(books);
  const frame = mesh(box(0.06, 0.65, 0.65), toon(PALETTE.wood), w / 2 - 0.055, 2.35, 0.3, false);
  const print = mesh(box(0.012, 0.54, 0.54), toon(color), w / 2 - 0.093, 2.35, 0.3, false);
  group.add(frame, print);
  const motif = mesh(new THREE.CircleGeometry(0.17, slot + 3), toon('#fffaf3'), w / 2 - 0.102, 2.35, 0.3, false);
  motif.rotation.y = -Math.PI / 2;
  group.add(motif);
  const mug = ownModel(deskMug(color));
  mug.position.set(f.computer.x - 0.32, 0.78, f.computer.z + 0.06);
  group.add(mug);
  const spareDesk = simpleDesk(f.computerDesk.width, f.computerDesk.depth);
  spareDesk.position.set(f.computer.x, 0, f.computer.z);
  group.add(spareDesk);

  const lamp = new THREE.Group();
  lamp.name = 'cubby-desk-lamp';
  lamp.position.set(f.computer.x + 0.34, 0.78, f.computer.z - 0.1);
  const metal = toon(PALETTE.ink);
  lamp.add(mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.04, 12), metal, 0, 0.02, 0, false));
  lamp.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 6), metal, 0, 0.21, 0, false));
  lamp.add(mesh(new THREE.ConeGeometry(0.19, 0.19, 12, 1, true), toon(color), 0, 0.43, 0, false));
  lamp.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), toon('#fff7d6', { emissive: '#ffe08a' }), 0, 0.38, 0, false));
  const bulbs = ownBulbs(lamp);
  const light = new THREE.PointLight('#ffe2b8', 0, 4, 1.6);
  light.position.set(0, 0.33, 0.08);
  lamp.add(light);
  group.add(lamp);
  return { group, spareDesk, light, bulbs };
}
