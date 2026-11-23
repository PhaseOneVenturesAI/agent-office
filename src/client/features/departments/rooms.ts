import * as THREE from 'three';
import { DEPARTMENT_ROOMS, ROOM_HEIGHT, departmentRoomWalls, type DepartmentRoom } from '../../../shared/department-rooms';
import type { Department } from '../../../shared/protocol';
import { glassPane, PALETTE } from '../../world/office/materials';
import { mesh, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';

/** Walk-in studios, using the Office's existing glass, wood and rounded signage. */
export function buildDepartmentRooms() {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const painters: ((departments: Department[]) => void)[] = [];
  const frame = toon(PALETTE.ink);
  const wood = toon(PALETTE.wood);
  const cream = toon('#fffaf3');
  const H = ROOM_HEIGHT;
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

  for (const room of DEPARTMENT_ROOMS) {
    const studio = new THREE.Group();
    group.add(studio);
    const { minX, maxX, minZ, maxZ, door } = room;
    const front = door.side === 'north' ? minZ : maxZ;
    const back = door.side === 'north' ? maxZ : minZ;
    const facing = door.side === 'north' ? -1 : 1;
    for (const [x0, x1, z0, z1] of departmentRoomWalls(room)) {
      colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: H });
      const alongX = x1 - x0 > z1 - z0;
      const length = alongX ? x1 - x0 : z1 - z0;
      const n = Math.ceil(length / 2.1);
      const centerX = (x0 + x1) / 2;
      const centerZ = (z0 + z1) / 2;
      // Low cream skirting, fine dark frames and glass keep the studios legible from the hall.
      studio.add(mesh(box(x1 - x0, 0.22, z1 - z0), cream, centerX, 0.11, centerZ));
      studio.add(mesh(box(x1 - x0, 0.08, z1 - z0), wood, centerX, H - 0.04, centerZ));
      for (let i = 0; i < n; i++) {
        const u = -length / 2 + (i + 0.5) * length / n;
        const pane = glassPane(length / n - 0.06, H - 0.3);
        pane.position.set(centerX + (alongX ? u : 0), H / 2 + 0.07, centerZ + (alongX ? 0 : u));
        if (!alongX) pane.rotation.y = Math.PI / 2;
        studio.add(pane);
      }
      for (let i = 0; i <= n; i++) {
        const u = -length / 2 + i * length / n;
        studio.add(mesh(box(0.065, H, 0.065), frame, centerX + (alongX ? u : 0), H / 2, centerZ + (alongX ? 0 : u)));
      }
    }
    // An open 2m portal, not a door-shaped wall. A timber lintel makes the threshold visible.
    studio.add(mesh(box(door.width, 0.13, 0.16), wood, door.x, H - 0.065, front));
    const sign = textPlane(room.name, { bg: '#fffaf3', color: PALETTE.ink, border: PALETTE.ink, size: 46 });
    sign.scale.multiplyScalar(0.5);
    sign.position.set(door.x, H + 0.28, front + facing * 0.12);
    if (facing < 0) sign.rotation.y = Math.PI;
    studio.add(sign);
    const it: Interactable = { kind: 'departments', label: room.preset, x: door.x, z: front + facing * 0.65, radius: 1.15 };
    sign.userData.interact = it;
    interactables.push(it);

    // The room's actual project information lives on an inward-facing board, behind its desks.
    const board = roomBoard(room);
    board.group.position.set((minX + maxX) / 2, 1.7, back + facing * 0.12);
    if (facing < 0) board.group.rotation.y = Math.PI;
    const boardIt: Interactable = { kind: 'departments', label: room.preset, x: (minX + maxX) / 2, z: back + facing * 0.75, radius: 1.2 };
    board.group.userData.interact = boardIt;
    interactables.push(boardIt);
    studio.add(board.group);
    painters.push((departments) => board.show(departments.find((d) => d.preset === room.preset)));
  }
  return { group, colliders, interactables, show: (departments: Department[]) => painters.forEach((paint) => paint(departments)) };
}

function roomBoard(room: DepartmentRoom) {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 430;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const review = room.preset === 'review';
  const background = review ? PALETTE.ink : '#fffaf3';
  const ink = review ? '#fffaf3' : PALETTE.ink;
  group.add(mesh(new THREE.BoxGeometry(4.65, 1.95, 0.09), toon(PALETTE.wood), 0, 0, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.88), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.z = 0.055;
  group.add(face);
  const title = room.preset === 'marketing' ? 'Brand & creative studio' : review ? 'Screening & review' : 'Build & delivery';
  const show = (department?: Department) => {
    g.fillStyle = background;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#ff8a5b';
    g.fillRect(0, 0, 14, canvas.height);
    g.fillStyle = ink;
    g.font = '900 44px Nunito, system-ui, sans-serif';
    g.fillText(title, 42, 65, 940);
    g.font = '700 27px Nunito, system-ui, sans-serif';
    g.fillText(department ? `${department.name} · ${department.roster.length} assigned` : 'Ready to set up for this project', 42, 112, 940);
    const current = department?.assets.filter((asset) => asset.status === 'current') ?? [];
    const lines = room.preset === 'marketing'
      ? current.length ? current.slice(0, 4).map((asset) => asset.label) : ['Your brand references appear here.', 'Add the brief, design guide and current assets.']
      : review ? ['Compare versions. Keep the feedback.', 'Approval and release stay separate.', 'Open the department for its Review Room.']
        : ['Brief → scoped work → verification', department?.brief[0]?.text ?? 'Set the next outcome in the department brief.', 'Existing project workers keep their desks.'];
    g.font = '600 27px Nunito, system-ui, sans-serif';
    lines.forEach((line, i) => g.fillText(line.replace(/\s+/g, ' ').slice(0, 95), 42, 175 + i * 45, 940));
    g.font = '800 26px Nunito, system-ui, sans-serif';
    g.fillText('E · Open this department', 42, 395, 940);
    texture.needsUpdate = true;
  };
  show();
  return { group, show };
}
