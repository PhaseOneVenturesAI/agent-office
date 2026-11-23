import * as THREE from 'three';
import { DEPARTMENTS } from '../../../shared/layout';
import type { Department } from '../../../shared/protocol';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The department directory: a standing sign by the north wall between the PR board and the gong.
// Its face lists the floor's departments and their corners live; walk up and press E and the
// Departments panel opens (see index.ts).

const WOOD = '#8a5a3b';
const BRASS = '#c9a227';
const INK = '#2b2d42';
/** The face's canvas, in pixels per meter. */
const PX = 300;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

const PRESET_ICON: Record<Department['preset'], string> = { marketing: '📣', product: '🛠️', review: '🔍' };

export interface DepartmentsDirectory {
  group: THREE.Group;
  colliders: Collider[];
  /** Walk up and press E. */
  interactable: Interactable;
  /** Puts the floor's departments on the face. */
  show(departments: Department[]): void;
}

export function buildDepartmentsDirectory(): DepartmentsDirectory {
  const { x, z, width, height, bottom } = DEPARTMENTS;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const wood = toon(WOOD);
  const brass = toon(BRASS);
  const mid = bottom + height / 2;
  const post = width / 2 - 0.08;

  // The directory panel in its wooden frame, on two posts with feet.
  const frame = mesh(roundedBox(width + 0.1, 0.07, height + 0.1, 0.04), wood, 0, mid, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(height * PX);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, mid, 0.045);
  group.add(face);
  for (const sx of [-post, post]) {
    group.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, bottom + height + 0.12, 10), wood, sx, (bottom + height + 0.12) / 2, -0.02));
    group.add(mesh(roundedBox(0.34, 0.06, 0.5, 0.03), wood, sx, 0.03, 0));
    group.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), brass, sx, bottom + height + 0.14, -0.02, false));
  }

  const plaque = textPlane('🏬 Departments', { bg: '#fffaf3', size: 48 });
  plaque.scale.multiplyScalar(0.5);
  plaque.position.set(0, bottom + height + 0.3, 0.05);
  group.add(plaque);

  const colliders: Collider[] = [{ minX: x - post - 0.2, maxX: x + post + 0.2, minZ: z - 0.3, maxZ: z + 0.3, top: bottom + height + 0.2 }];
  const interactable: Interactable = { kind: 'departments', x, z: z + 1.4, radius: 2.2 };
  group.userData.interact = interactable;

  const show = (departments: Department[]) => {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = BRASS;
    g.lineWidth = 6;
    g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = INK;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = `900 54px ${FONT}`;
    g.fillText('Departments', W / 2, 34);
    g.textAlign = 'left';
    if (!departments.length) {
      g.font = `700 34px ${FONT}`;
      g.fillStyle = '#8a8f98';
      g.fillText('None on this floor yet.', 48, 130);
      g.font = `600 28px ${FONT}`;
      g.fillText('Press E to open one —', 48, 196);
      g.fillText('a brief, roles and a brand library,', 48, 240);
      g.fillText('never an auto-running team.', 48, 284);
    } else {
      g.font = `700 40px ${FONT}`;
      let y = 118;
      for (const d of departments.slice(0, 4)) {
        const desks = d.desks.length ? ` — ${d.desks.length} desk${d.desks.length === 1 ? '' : 's'}` : '';
        g.fillStyle = INK;
        g.fillText(`${PRESET_ICON[d.preset]} ${d.name}`, 48, y);
        g.fillStyle = '#8a8f98';
        g.font = `600 30px ${FONT}`;
        g.fillText(`${d.roster.length ? `${d.roster.length} assigned` : 'no one hired yet'}${desks}${d.lead ? ` · 🎖️ ${d.lead.name}` : ''}`, 96, y + 52);
        g.font = `700 40px ${FONT}`;
        y += 108;
      }
      if (departments.length > 4) {
        g.fillStyle = '#8a8f98';
        g.font = `600 28px ${FONT}`;
        g.fillText(`…and ${departments.length - 4} more — press E`, 48, y);
      }
    }
    texture.needsUpdate = true;
  };
  show([]);

  return { group, colliders, interactable, show };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The directory of the floor's departments, by the north wall. */
    departments: DepartmentsDirectory;
  }
}

/** The department directory, by the north wall between the PR board and the gong. */
export const departments: Fixture<'departments'> = () => {
  const built = buildDepartmentsDirectory();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], handle: { departments: built } };
};
