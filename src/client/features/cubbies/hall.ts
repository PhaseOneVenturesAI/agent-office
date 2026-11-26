// The cubby hall as the office floor builds it (see shared/cubbyhall.ts): a strip of building west of
// the west wall, with its own floor, slab, ceiling and walls painted like the office's inside and out,
// lamps over its corridor, the partitions and the header between the cubbies, and a doorway through
// the old west wall with a dark "🚪 Cubby hall" sign over it. The cubbies themselves (their glass
// fronts, signs and insides) are CubbyRoom's, placed by the cubbies feature at HALL_PLACES.
//
// It's all put away until the floor has cubbies (set(true)): until then the doorway is plain wall, and
// nothing here is drawn or bumped into, so a floor without cubbies is exactly as it always was.

import * as THREE from 'three';
import { CUBBY_DOORWAY, CUBBY_HALL, HALL_FRONT_X, HALL_OUTER, HALL_PLACES, HALL_WINDOWS, PARTITION_HEIGHT, hallPartitions, type HallPlace } from '../../../shared/cubbyhall';
import { FLOOR, PLANTS, SLAB, WALL_HEIGHT, WALL_T, WINDOWS, type Opening } from '../../../shared/layout';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE, box, type Looks } from '../../world/office/materials';
import { pendant } from '../../world/office/props';
import { ownBulbs, type InteriorLamp } from '../../world/office/interior-lights';
import { wallRun, windowIn } from '../../world/office/shell';
import { mesh, textPlane, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import { CREAM, INK } from './props';

/** The cubby hall on the floor you're on. */
export interface CubbyHall {
  /** Whether it's open: drawn, walked into, and the doorway through to it. */
  readonly on: boolean;
  /** Opens it (true) or walls it up again (false). */
  set(on: boolean): void;
  /** Where its cubbies go, slot 0 by the doorway. */
  readonly places: readonly HallPlace[];
  /** Everything it draws (the doorway's plug, which stands while it's shut, isn't in here). */
  readonly group: THREE.Group;
  /** What you bump into while it's open. */
  readonly colliders: readonly Collider[];
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The cubby hall west of the west wall, shut until the floor has cubbies (see features/cubbies). */
    cubbyHall: CubbyHall;
  }
}

/**
 * A warm, light lining over the old west wall's outside face where the corridor runs along it, so the
 * corridor reads as an inside hallway rather than the building's dark exterior. It leaves the windows
 * and the doorway open.
 */
function corridorLining(d: number, midZ: number): THREE.Group {
  const g = new THREE.Group();
  const mat = toon('#efe4d2');
  const x = CUBBY_HALL.maxX - 0.012;
  const z0 = midZ - d / 2, z1 = midZ + d / 2;
  const holes = [...WINDOWS.filter(w => w.wall === 'west'), CUBBY_DOORWAY]
    .map(o => ({ a: o.u - o.width / 2, b: o.u + o.width / 2, y0: o.y0, y1: o.y1 }))
    .filter(o => o.b > z0 && o.a < z1).sort((p, q) => p.a - q.a);
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    g.add(mesh(new THREE.PlaneGeometry(b - a, y1 - y0).rotateY(-Math.PI / 2), mat, x, (y0 + y1) / 2, (a + b) / 2, false));
  };
  let at = z0;
  for (const o of holes) {
    piece(at, Math.max(at, o.a), 0, WALL_HEIGHT);
    piece(Math.max(at, o.a), Math.min(z1, o.b), 0, o.y0);
    piece(Math.max(at, o.a), Math.min(z1, o.b), o.y1, WALL_HEIGHT);
    at = Math.max(at, o.b);
  }
  piece(at, z1, 0, WALL_HEIGHT);
  return g;
}

/** The bit of west wall where the doorway goes, standing while the hall's shut: like exitPlug in shell.ts. */
function doorwayPlug(looks: Looks): { group: THREE.Group; collider: Collider } {
  const o = CUBBY_DOORWAY;
  const x = FLOOR.minX - WALL_T / 2;
  const group = new THREE.Group();
  // A box's faces go +x, -x, +y, -y, +z, -z; on the west wall, -x is outdoors.
  const mats = Array.from({ length: 6 }, (_, i) => (i === 1 ? toon(PALETTE.exterior) : looks.wall));
  const wall = new THREE.Mesh(box(WALL_T, o.y1 - o.y0, o.width), mats);
  wall.position.set(x, (o.y0 + o.y1) / 2, o.u);
  wall.receiveShadow = true;
  wall.userData.wall = true;
  group.add(wall);
  group.add(mesh(box(WALL_T + 0.04, 0.25, o.width), looks.trim, x, 0.125, o.u, false));
  return { group, collider: { minX: FLOOR.minX - WALL_T, maxX: FLOOR.minX, minZ: o.u - o.width / 2, maxZ: o.u + o.width / 2, top: 99 } };
}

/** The doorway's white frame and threshold, through the old wall. */
function doorwayFrame(): THREE.Group {
  const o = CUBBY_DOORWAY;
  const g = new THREE.Group();
  const frame = toon('#ffffff');
  const F = 0.08;
  const D = WALL_T + 0.04;
  const x = FLOOR.minX - WALL_T / 2;
  g.add(mesh(box(D, F, o.width), frame, x, o.y1 - F / 2, o.u, false));
  for (const s of [-1, 1]) g.add(mesh(box(D, o.y1, F), frame, x, o.y1 / 2, o.u + s * (o.width / 2 - F / 2), false));
  g.add(mesh(box(D, 0.03, o.width), toon('#8d99ae'), x, 0.015, o.u, false));
  return g;
}

/**
 * The old west wall's outer face, seen from inside the hall: painted like the office's inside, round
 * its windows and the doorway, so the corridor reads as a room and not the outside of the building.
 */
function innerFacing(looks: Looks): THREE.Group {
  const g = new THREE.Group();
  const x = FLOOR.minX - WALL_T - 0.012;
  const holes: Opening[] = [...WINDOWS.filter((o) => o.wall === 'west' && o.u < CUBBY_HALL.maxZ), CUBBY_DOORWAY].sort((a, b) => a.u - b.u);
  const piece = (u0: number, u1: number, y0: number, y1: number) => {
    if (u1 - u0 < 0.001 || y1 - y0 < 0.001) return;
    const m = new THREE.Mesh(box(0.02, y1 - y0, u1 - u0), looks.wall);
    m.position.set(x, (y0 + y1) / 2, (u0 + u1) / 2);
    m.receiveShadow = true;
    g.add(m);
  };
  let u: number = CUBBY_HALL.minZ;
  for (const o of holes) {
    const h0 = o.u - o.width / 2 - 0.1;
    const h1 = o.u + o.width / 2 + 0.1;
    piece(u, h0, 0, WALL_HEIGHT);
    piece(h0, h1, 0, o.y0 - 0.06);
    piece(h0, h1, o.y1 + 0.03, WALL_HEIGHT);
    u = h1;
  }
  piece(u, CUBBY_HALL.maxZ, 0, WALL_HEIGHT);
  // Its baseboard, either side of the doorway.
  const d = CUBBY_DOORWAY;
  for (const [u0, u1] of [[CUBBY_HALL.minZ, d.u - d.width / 2], [d.u + d.width / 2, CUBBY_HALL.maxZ]]) g.add(mesh(box(0.04, 0.25, u1 - u0), looks.trim, x - 0.01, 0.125, (u0 + u1) / 2, false));
  return g;
}

/** Builds the hall (shut) into the floor: what it draws, and its colliders, kept aside until it opens. */
function buildHall(looks: Looks, planks: THREE.Material, ceiling: THREE.Material): { group: THREE.Group; colliders: Collider[]; lights: InteriorLamp['lights']; bulbs: InteriorLamp['bulbs'] } {
  const lights: InteriorLamp['lights'] = [], bulbs: InteriorLamp['bulbs'] = [];
  const T = WALL_T;
  const H = CUBBY_HALL;
  const O = HALL_OUTER;
  const group = new THREE.Group();
  group.name = 'cubby-hall';
  const colliders: Collider[] = [];

  // Its walls: the outer west one, and the north and south ends back to the old wall.
  wallRun(group, colliders, 'z', H.minX - T / 2, O.minZ, O.maxZ, -1, [...HALL_WINDOWS], looks, [true, true]);
  wallRun(group, colliders, 'x', H.minZ - T / 2, H.minX, H.maxX, -1, [], looks, [false, false]);
  wallRun(group, colliders, 'x', H.maxZ + T / 2, H.minX, H.maxX, 1, [], looks, [false, false]);
  for (const opening of HALL_WINDOWS) {
    const window = windowIn(opening);
    window.position.x = H.minX - T / 2;
    group.add(window);
  }
  group.add(innerFacing(looks));
  group.add(doorwayFrame());

  // The floor: the room's planks carried on through (lined up with them), on a slab like the room's.
  const w = H.maxX - H.minX;
  const d = H.maxZ - H.minZ;
  const midX = (H.minX + H.maxX) / 2;
  const midZ = (H.minZ + H.maxZ) / 2;
  const floorGeo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(midX, 0, midZ);
  const uv = floorGeo.getAttribute('uv');
  const pos = floorGeo.getAttribute('position');
  for (let k = 0; k < pos.count; k++) uv.setXY(k, (pos.getX(k) - FLOOR.minX) / (FLOOR.maxX - FLOOR.minX), (FLOOR.maxZ - pos.getZ(k)) / (FLOOR.maxZ - FLOOR.minZ));
  const floor = new THREE.Mesh(floorGeo, planks);
  floor.receiveShadow = true;
  group.add(floor);
  // A runner down the corridor, so it reads as the way along.
  group.add(mesh(new THREE.PlaneGeometry(HALL_FRONT_X - H.maxX + 0.5, d - 0.6).rotateX(-Math.PI / 2), toon('#cdb4db'), (HALL_FRONT_X + H.maxX) / 2, 0.006, midZ, false));
  const band = toon('#e8a87c');
  const concrete = toon('#d3d6dd');
  const slab = new THREE.Mesh(box(O.maxX - O.minX, SLAB - 0.01, O.maxZ - O.minZ), [band, band, concrete, concrete, band, band]);
  slab.position.set((O.minX + O.maxX) / 2, -SLAB / 2 - 0.005, (O.minZ + O.maxZ) / 2);
  slab.receiveShadow = true;
  group.add(slab);
  colliders.push({ ...O, bottom: -SLAB, top: 0 });

  // The ceiling's tiles, WALL_HEIGHT up like the room's, and its roof over them.
  const ceilGeo = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(midX, WALL_HEIGHT, midZ);
  const cuv = ceilGeo.getAttribute('uv');
  const cpos = ceilGeo.getAttribute('position');
  for (let k = 0; k < cpos.count; k++) cuv.setXY(k, cpos.getX(k), cpos.getZ(k));
  group.add(new THREE.Mesh(ceilGeo, ceiling));
  group.add(mesh(box(O.maxX - O.minX, 0.02, O.maxZ - O.minZ), toon('#fffaf3'), (O.minX + O.maxX) / 2, WALL_HEIGHT + 0.03, (O.minZ + O.maxZ) / 2, false));
  colliders.push({ minX: H.minX, maxX: H.maxX, minZ: H.minZ, maxZ: H.maxZ, bottom: WALL_HEIGHT, top: WALL_HEIGHT + SLAB });

  // The partitions between the cubbies, and the header over their glass fronts that their signs hang on.
  const wallMat = looks.wall;
  for (const p of hallPartitions()) {
    group.add(mesh(box(p.maxX - p.minX, PARTITION_HEIGHT, p.maxZ - p.minZ), wallMat, (p.minX + p.maxX) / 2, PARTITION_HEIGHT / 2, (p.minZ + p.maxZ) / 2));
    group.add(mesh(box(p.maxX - p.minX, 0.06, p.maxZ - p.minZ + 0.04), looks.trim, (p.minX + p.maxX) / 2, PARTITION_HEIGHT + 0.03, (p.minZ + p.maxZ) / 2, false));
    colliders.push({ ...p, top: PARTITION_HEIGHT });
  }
  const headerY0 = 2.8;
  group.add(mesh(box(0.1, PARTITION_HEIGHT - headerY0, d), wallMat, HALL_FRONT_X - 0.02, (headerY0 + PARTITION_HEIGHT) / 2, midZ, false));
  group.add(mesh(box(0.14, 0.06, d), looks.trim, HALL_FRONT_X - 0.02, PARTITION_HEIGHT + 0.03, midZ, false));

  // Lamps: one over each cubby, and down the corridor between them.
  for (const p of HALL_PLACES) {
    const lamp = pendant(WALL_HEIGHT - 4.05);
    lamp.position.set(p.x, 4.05, p.z);
    group.add(lamp);
    bulbs.push(...ownBulbs(lamp));
  }
  for (const z of [-9, -1.5, 4]) {
    const lamp = pendant(WALL_HEIGHT - 4.4);
    lamp.scale.setScalar(0.6);
    lamp.position.set((HALL_FRONT_X + H.maxX) / 2, 4.4, z);
    group.add(lamp);
    bulbs.push(...ownBulbs(lamp));
    // Real warm light from the corridor lamps, so the hall isn't a dark slot (no shadows: cheap on phones).
    const light = new THREE.PointLight('#ffe2b8', 0, 9, 1.6);
    light.position.set((HALL_FRONT_X + H.maxX) / 2, 3.6, z);
    group.add(light);
    lights.push({ light, power: 7 });
  }
  group.add(corridorLining(d, midZ));

  // The dark sign pill over the doorway, on the office side; and its twin over it in the corridor.
  for (const side of [1, -1]) {
    const sign = textPlane('🚪 Cubby hall', { bg: INK, color: CREAM, size: 44, border: CREAM });
    sign.scale.setScalar(0.9);
    sign.position.set(side > 0 ? FLOOR.minX + 0.02 : FLOOR.minX - WALL_T - 0.03, CUBBY_DOORWAY.y1 + 0.38, CUBBY_DOORWAY.u);
    sign.rotation.y = (side * Math.PI) / 2;
    group.add(sign);
  }
  group.visible = false;
  return { group, colliders, lights, bulbs };
}

/** The cubby hall, shut until the floor has cubbies. */
export const cubbyHall: Fixture<'cubbyHall'> = (site) => {
  const plug = doorwayPlug(site.looks);
  site.group.add(plug.group);
  site.colliders.push(plug.collider);
  const built = buildHall(site.looks, site.planks, site.get('stack').ceiling);
  site.group.add(built.group);
  // The plant in the corner by the doorway steps back into the corner while it's open, out of the way in.
  const [px, pz, ps] = PLANTS[0];
  const pot = site.get('plants')[0];
  const r = 0.3 * ps;
  const potCollider = site.colliders.find((c) => c.minX === px - r && c.maxX === px + r && c.minZ === pz - r && c.maxZ === pz + r);
  const tucked = { x: px - 0.25, z: FLOOR.minZ + r + 0.03 };

  const take = (list: readonly Collider[]) => {
    for (const c of list) {
      const i = site.colliders.indexOf(c);
      if (i >= 0) site.colliders.splice(i, 1);
    }
  };
  const movePlant = (x: number, z: number) => {
    pot.position.x = x;
    pot.position.z = z;
    if (!potCollider) return;
    Object.assign(potCollider, { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  };

  const hall: CubbyHall = {
    on: false,
    places: HALL_PLACES,
    group: built.group,
    colliders: built.colliders,
    set(on) {
      if (on === hall.on) return;
      (hall as { on: boolean }).on = on;
      built.group.visible = on;
      plug.group.visible = !on;
      if (on) {
        take([plug.collider]);
        site.colliders.push(...built.colliders);
        movePlant(tucked.x, tucked.z);
      } else {
        take(built.colliders);
        site.colliders.push(plug.collider);
        movePlant(px, pz);
      }
    },
  };
  site.get('interiorLights').add({ active: () => hall.on, lights: built.lights, bulbs: built.bulbs });
  return { handle: { cubbyHall: hall } };
};
