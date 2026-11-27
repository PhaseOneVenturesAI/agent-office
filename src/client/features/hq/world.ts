import { taskBoard } from './task-board';
import * as THREE from 'three';
import { departmentLabel } from './labels';
import type { HQProject, HQView } from '../../../shared/protocol/hq';
import { ELEVATOR_FRONT } from '../../../shared/layout';
import type { Fixture } from '../../world/office/fixture';
import type { Collider, Interactable } from '../../world/types';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import { disposeTree, Face, fitText } from '../cubbies/props';

const INK = '#292638', PAPER = '#fff7e9';
/** Six areas with walking aisles; the elevator, gong and pitch room keep their existing footprints. */
export const AREAS = [[-11.5, -5], [-3, -5], [5.5, -5], [-11.5, 3], [-3, 3], [5.5, 3]] as const;
function sign(text: string, width: number) {
  const p = textPlane(text, { bg: PAPER, color: INK, size: 48, border: '#d9c6ab' });
  const w = p.geometry.parameters.width;
  p.scale.setScalar(Math.min(1, width / w));
  p.userData.hqLabel = true;
  return p;
}
export class HQWorld {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly coveredFurniture: THREE.Object3D[] = [];
  readonly coveredColliders: Collider[] = [];
  readonly interactables: Interactable[] = [];
  private faces: Face[] = [];
  constructor() { this.group.name = 'hq'; this.group.visible = false; }
  set(view: HQView) {
    this.group.traverse(o => {
      if (o instanceof THREE.Line) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); }
    });
    this.faces.forEach(f => f.dispose()); this.faces = [];
    disposeTree(this.group); this.group.clear(); this.colliders.length = 0; this.interactables.length = 0;
    const entry = sign('🔒 HQ', 1.2); entry.name = 'hq-entry-label'; entry.position.set(7.4, 1, ELEVATOR_FRONT + 0.3); this.group.add(entry);
    const pitch = sign('102 · Pitch room', 1.9); pitch.name = 'hq-pitch-label'; pitch.position.set(12.5, 2.7, 6); this.group.add(pitch);
    if (!view.projects.length) {
      const empty = this.panel(4.4, 2, 'hq-empty', (c, w) => {
        c.fillStyle = INK; c.font = 'bold 40px sans-serif'; c.textAlign = 'center';
        c.fillText('Connect your Mac', w / 2, 160); c.fillText('in your cubby', w / 2, 225); c.fillText('to fill HQ', w / 2, 290);
      });
      empty.position.set(2, 2.25, -6); this.group.add(empty); return;
    }
    view.projects.slice(0, 6).forEach((project, i) => this.area(project, i, view.ownerColor));
    const wall = this.panel(22, 4.4, 'hq-portfolio', (c, w, h) => {
      c.fillStyle = view.ownerColor; c.fillRect(0, 0, w, 92);
      c.fillStyle = '#fff'; c.font = 'bold 48px sans-serif';
      c.fillText('PORTFOLIO', 35, 63);
      if (view.projects.length > 4) { c.textAlign = 'right'; c.fillText(`+${view.projects.length - 4} more`, w - 35, 63); c.textAlign = 'left'; }
      const shown = view.projects.slice(0, 4), cw = (w - 60) / shown.length;
      shown.forEach((p, i) => {
        const x = 30 + i * cw;
        if (i < shown.length - 1) { c.fillStyle = '#decfbb'; c.fillRect(x + cw - 14, 112, 2, h - 136); }
        c.fillStyle = INK; c.font = 'bold 72px sans-serif';
        fitText(c, p.name, x + 8, 180, cw - 32);
        c.font = '40px sans-serif';
        let y = 248;
        if (p.hasMainLead) { c.fillText('CEO', x + 8, y); y += 41; }
        for (const d of p.departmentLeads) {
          fitText(c, departmentLabel(d), x + 8, y, cw - 32); y += 41;
        }
      });
    }, 3072);
    wall.position.set(-5, 4.2, -12.78); this.group.add(wall);
    this.target(wall, -5, -10.5, 'Portfolio');
  }
  private target(object: THREE.Object3D, x: number, z: number, label: string) {
    const it: Interactable = { kind: 'hqboard', x, z, radius: 3.5, label };
    object.userData.interact = it; this.interactables.push(it);
  }
  private panel(w: number, h: number, name: string, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void, pixels = 1024) {
    const f = new Face(w, h, pixels); this.faces.push(f);
    f.draw(name, (c, w, h) => { c.fillStyle = PAPER; c.fillRect(0, 0, w, h); paint(c, w, h); });
    f.mesh.name = name; return f.mesh;
  }
  private area(project: HQProject, index: number, color: string) {
    const [x, z] = AREAS[index], g = new THREE.Group(); g.name = `hq-area-${index}`; g.position.set(x, 0, z);
    const points = [new THREE.Vector3(-3.7, .025, -3.25), new THREE.Vector3(3.7, .025, -3.25), new THREE.Vector3(3.7, .025, 3.25), new THREE.Vector3(-3.7, .025, 3.25), new THREE.Vector3(-3.7, .025, -3.25)];
    const border = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, dashSize: .3, gapSize: .18 }));
    border.computeLineDistances(); g.add(border);
    // A low sign on posts at the front corner, separate from the desk sightline.
    const name = this.panel(1.9, .2, `hq-project-label-${index}`, (c, w, h) => {
      c.fillStyle = INK; c.font = 'bold 85px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, project.name, w / 2, h / 2, w - 60);
    });
    name.userData.hqLabel = true; name.position.set(-2.55, .24, 3.1); g.add(name);
    const back = name.clone(); back.name += '-back'; back.rotation.y = Math.PI; back.position.z -= .02; g.add(back);
    for (const dx of [-.7, .7]) g.add(mesh(new THREE.BoxGeometry(.045, .24, .045), toon(color), -2.55 + dx, .12, 3.07));
    this.desk(g, x, z, 0, -1.7, 2.7, 1.25, 'CEO', color);
    // Eight bounded departments fit as two rows of four; no people or fabricated activity.
    project.departmentLeads.forEach((d, i) => this.desk(g, x, z, -2.65 + i % 4 * 1.75, .45 + Math.floor(i / 4) * 1.55, 1.35, .7, d.department, color, i < 4 ? .6 : .38));
    const board = this.panel(1.9, 1.6, `hq-tasks-${index}`, (c, w) => taskBoard(c, w, project));
    const easel = new THREE.Group(); easel.name = `hq-easel-${index}`;
    easel.position.set(3.45, 0, -.7); easel.rotation.y = Math.PI / 2;
    board.position.set(0, 1.3, .04); easel.add(board);
    const reverse = board.clone(); reverse.name += '-back'; reverse.rotation.y = Math.PI; reverse.position.z = -.04; easel.add(reverse);
    easel.add(mesh(new THREE.BoxGeometry(1.98, 1.68, .06), toon(color), 0, 1.3, 0));
    for (const dx of [-.5, .5]) easel.add(mesh(new THREE.BoxGeometry(.055, .5, .38), toon('#765135'), dx, .25, 0));
    g.add(easel);
    this.colliders.push({ minX: x + 3.26, maxX: x + 3.64, minZ: z - 1.69, maxZ: z + .29, top: 2.14 });
    this.target(easel, x + 3.45, z - .7, project.name);
    this.group.add(g);
  }
  private desk(g: THREE.Group, ax: number, az: number, x: number, z: number, w: number, d: number, title: string, color: string, labelY = .76) {
    const desk = new THREE.Group(); desk.name = `hq-desk-${title}`; desk.position.set(x, 0, z);
    desk.add(mesh(roundedBox(w, .12, d, .06), toon('#b68150'), 0, .79, 0));
    desk.add(mesh(new THREE.BoxGeometry(w, .055, .045), toon(color), 0, .84, d / 2));
    for (const side of [-1, 1]) desk.add(mesh(new THREE.BoxGeometry(.12, .73, d * .8), toon('#765135'), side * (w / 2 - .15), .365, 0));
    desk.add(mesh(new THREE.BoxGeometry(w - .16, .44, .045), toon('#765135'), 0, .57, d / 2 - .02));
    const tag = this.panel(w > 2 ? .4 : 1, .12, `hq-desk-label-${g.name}-${title}`, (c, pw, ph) => {
      c.fillStyle = INK; c.font = `bold ${w > 2 ? 240 : 110}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, title, pw / 2, ph / 2, pw - 55);
    });
    tag.userData.hqLabel = true; tag.position.set(0, labelY, d / 2 + .025); desk.add(tag); g.add(desk);
    this.colliders.push({ minX: ax + x - w / 2, maxX: ax + x + w / 2, minZ: az + z - d / 2, maxZ: az + z + d / 2, top: .85 });
  }
}
declare module '../../world/types' { interface OfficeHandles { hq: HQWorld } }
export const hq: Fixture<'hq'> = site => {
  const hq = new HQWorld();
  // Pod rugs and any standalone low partitions in the HQ footprint. Desk groups
  // include their modesty panels; keep room furniture, plants and fixtures intact.
  for (const o of site.group.children) {
    if (!(o instanceof THREE.Mesh)) continue;
    const box = new THREE.Box3().setFromObject(o);
    if (box.min.y < 0 || box.max.y > 1.6) continue;
    const rug = box.max.y < .04;
    const partition = o.geometry instanceof THREE.BoxGeometry && box.min.y > .04;
    if (!(rug || partition) || !AREAS.some(([x, z]) => box.max.x > x - 3.7 && box.min.x < x + 3.7 && box.max.z > z - 3.25 && box.min.z < z + 3.25)) continue;
    hq.coveredFurniture.push(o);
    hq.coveredColliders.push(...site.colliders.filter(c => c.top <= box.max.y + .05 && c.minX >= box.min.x - .05 && c.maxX <= box.max.x + .05 && c.minZ >= box.min.z - .05 && c.maxZ <= box.max.z + .05));
  }
  return { group: hq.group, handle: { hq } };
};
