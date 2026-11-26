import * as THREE from 'three';
import type { HQProject, HQView } from '../../../shared/protocol/hq';
import { ELEVATOR_FRONT } from '../../../shared/layout';
import type { Fixture } from '../../world/office/fixture';
import type { Collider, Interactable } from '../../world/types';
import { mesh, roundedBox, textSprite, toon } from '../../world/toon';
import { disposeTree, Face } from '../cubbies/props';

const INK = '#292638', PAPER = '#fff7e9';
/** Six areas with walking aisles; the elevator, gong and pitch room keep their existing footprints. */
export const AREAS = [[-11.5, -5], [-3, -5], [5.5, -5], [-11.5, 3], [-3, 3], [5.5, 3]] as const;
function pill(text: string, width: number) {
  const p = textSprite(text, { bg: PAPER, color: INK, size: 48, border: '#d9c6ab' });
  if (p.scale.x > width) p.scale.multiplyScalar(width / p.scale.x);
  return p;
}
export class HQWorld {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly interactables: Interactable[] = [];
  private faces: Face[] = [];
  constructor() { this.group.name = 'hq'; this.group.visible = false; }
  set(view: HQView) {
    this.group.traverse(o => {
      if (o instanceof THREE.Line) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); }
    });
    this.faces.forEach(f => f.dispose()); this.faces = [];
    disposeTree(this.group); this.group.clear(); this.colliders.length = 0; this.interactables.length = 0;
    const sign = pill('🔒 HQ', 1.6); sign.position.set(7.4, 2.35, ELEVATOR_FRONT + 0.3); this.group.add(sign);
    const pitch = pill('102 · Pitch room', 2.8); pitch.position.set(12.5, 2.7, 6); this.group.add(pitch);
    if (!view.projects.length) {
      const empty = this.panel(4.4, 2, 'hq-empty', (c, w) => {
        c.fillStyle = INK; c.font = 'bold 40px sans-serif'; c.textAlign = 'center';
        c.fillText('Connect your Mac', w / 2, 160); c.fillText('in your cubby', w / 2, 225); c.fillText('to fill HQ', w / 2, 290);
      });
      empty.position.set(2, 2.25, -6); this.group.add(empty); return;
    }
    view.projects.slice(0, 6).forEach((project, i) => this.area(project, i, view.ownerColor));
    const wall = this.panel(22, 4.8, 'hq-portfolio', (c, w, h) => {
      c.fillStyle = view.ownerColor; c.fillRect(0, 0, w, 92);
      c.fillStyle = '#fff'; c.font = 'bold 40px sans-serif';
      c.fillText('PORTFOLIO', 35, 61);
      if (view.projects.length > 6) { c.textAlign = 'right'; c.fillText(`+${view.projects.length - 6} more`, w - 35, 61); c.textAlign = 'left'; }
      const n = view.projects.length, cw = (w - 60) / n;
      view.projects.forEach((p, i) => {
        const x = 30 + i * cw;
        c.fillStyle = '#decfbb'; c.fillRect(x + cw - 14, 112, 2, h - 136);
        c.fillStyle = INK; c.font = `bold ${n > 6 ? 23 : 34}px sans-serif`;
        this.wrap(c, p.name, x + 8, 153, cw - 28, n > 6 ? 27 : 38);
        c.font = `${p.departmentLeads.length > 4 || n > 6 ? 19 : 25}px sans-serif`;
        let y = 225;
        if (p.hasMainLead) { c.fillText('CEO · Main lead', x + 8, y, cw - 28); y += 34; }
        for (const d of p.departmentLeads) {
          y = this.wrap(c, `${d.department} · ${d.title}`, x + 8, y, cw - 28, 28) + 14;
        }
      });
    }, 3072);
    wall.position.set(-5, 3.9, -12.78); this.group.add(wall);
    this.target(wall, -5, -10.5, 'Portfolio');
  }
  private target(object: THREE.Object3D, x: number, z: number, label: string) {
    const it: Interactable = { kind: 'hqboard', x, z, radius: 3.5, label };
    object.userData.interact = it; this.interactables.push(it);
  }
  private wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, line: number) {
    let row = '';
    for (const word of text.split(/\s+/)) {
      if (row && c.measureText(row + ' ' + word).width > width) { c.fillText(row, x, y, width); y += line; row = ''; }
      row += (row ? ' ' : '') + word;
    }
    c.fillText(row, x, y, width); return y + line;
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
    const name = pill(project.name, 4.6); name.position.set(0, 2.45, -2.2); g.add(name);
    this.desk(g, x, z, 0, -1.7, 2.7, 1.25, 'CEO', color);
    // Eight bounded departments fit as two rows of four; no people or fabricated activity.
    project.departmentLeads.forEach((d, i) => this.desk(g, x, z, -2.65 + i % 4 * 1.75, .45 + Math.floor(i / 4) * 1.55, 1.35, .7, d.department, color));
    const board = this.panel(6.8, .72, `hq-tasks-${index}`, (c, w) => {
      c.fillStyle = INK; c.font = 'bold 30px sans-serif'; c.fillText(`${project.name} tasks`, 24, 40, w - 48);
      c.font = '23px sans-serif'; c.fillText('Tasks appear here when the live loop is on', 24, 82, w - 48);
    });
    board.position.set(0, .7, 3.12); g.add(board);
    this.target(board, x, z + 3.5, project.name);
    this.group.add(g);
  }
  private desk(g: THREE.Group, ax: number, az: number, x: number, z: number, w: number, d: number, title: string, color: string) {
    const desk = new THREE.Group(); desk.name = `hq-desk-${title}`; desk.position.set(x, 0, z);
    desk.add(mesh(roundedBox(w, .12, d, .06), toon('#b68150'), 0, .79, 0));
    desk.add(mesh(new THREE.BoxGeometry(w, .055, .045), toon(color), 0, .84, d / 2));
    for (const side of [-1, 1]) desk.add(mesh(new THREE.BoxGeometry(.12, .73, d * .8), toon('#765135'), side * (w / 2 - .15), .365, 0));
    const tag = pill(title, w * .9); tag.position.set(0, 1.23, 0); desk.add(tag); g.add(desk);
    this.colliders.push({ minX: ax + x - w / 2, maxX: ax + x + w / 2, minZ: az + z - d / 2, maxZ: az + z + d / 2, top: .85 });
  }
}
declare module '../../world/types' { interface OfficeHandles { hq: HQWorld } }
export const hq: Fixture<'hq'> = () => {
  const hq = new HQWorld(); return { group: hq.group, handle: { hq } };
};
