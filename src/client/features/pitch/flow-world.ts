import * as THREE from 'three';
import { MEETING_TABLE as T, MEETING_ROOM as R, MEETING_BOARD as B } from '../../../shared/layout';
import type { PitchView } from '../../../shared/protocol/pitch';
import { pitchImageUrl } from '../../../shared/protocol/pitch';
import type { HQLead } from '../../../shared/protocol/hq';
import { pitchSpend } from '../../../shared/pitch/flow';
import { Face } from '../cubbies/props';
import type { Interactable } from '../../world/types';
/** The approved glass cards and table costs, with a private board over the shared meeting board. */
export class PitchFlowWorld {
  readonly group = new THREE.Group();
  readonly targets: Interactable[] = [];
  private faces: Face[] = [];
  private textures: THREE.Texture[] = [];
  private generation = 0;
  constructor() { this.group.name = 'pitch-flow-world'; }
  clear() { this.generation++; this.faces.forEach(f => {
    for (const child of f.mesh.children) if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
    f.dispose();
  }); this.textures.forEach(t => t.dispose()); this.faces = []; this.textures = []; this.group.clear(); this.targets.length = 0; }
  private card(name: string, lines: string[], x: number, y: number, z: number, w: number, height: number, rotation = 0, flat = false) {
    const face = new Face(w, height, 1200); this.faces.push(face);
    face.draw(JSON.stringify(lines), (g, width, h) => {
      g.fillStyle = '#fff7e9'; g.fillRect(0, 0, width, h); g.strokeStyle = '#d9c6ab'; g.lineWidth = 10; g.strokeRect(5, 5, width - 10, h - 10);
      g.fillStyle = '#292638';
      const board = name === 'pitch-brief-board', rowHeight = (h - 32) / Math.max(6, lines.length);
      const size = board ? Math.min(48, Math.floor(rowHeight * .8)) : 64;
      let at = size * 1.5;
      for (const [i, line] of lines.entries()) {
        g.font = `${i ? '' : 'bold '}${size}px sans-serif`;
        if (board) { g.fillText(line, 30, at, width - 60); at += rowHeight; continue; }
        let current = '';
        for (const word of line.split(/\s+/)) {
          if (g.measureText(current + word).width > width - 60) { g.fillText(current, 30, at); at += size * 1.2; current = ''; }
          current += word + ' ';
        }
        g.fillText(current, 30, at); at += size * 1.4;
      }
    });
    face.mesh.name = name; face.mesh.userData.lines = lines;
    face.mesh.position.set(x, y, z); face.mesh.rotation.y = rotation;
    if (flat) { face.mesh.rotation.x = -Math.PI / 2; face.mesh.rotateZ(Math.PI); }
    const it: Interactable = { kind: 'pitchflow', x, z, radius: 1, label: name };
    face.mesh.userData.interact = it; this.targets.push(it); this.group.add(face.mesh);
    return face;
  }
  show(view?: PitchView, lead?: HQLead) {
    this.clear();
    this.card('pitch-department-picker', ['Pitch room', 'E · Choose department'], T.x, T.height + .04, T.z + .25, 1.4, .45, 0, true);
    const p = view?.pitch; if (!p) return;
    const spend = pitchSpend(p), b = p.brief;
    if (b || p.costs || lead?.doing || lead?.helpers?.length) {
      const rows = [`${p.department} · ${p.status} · ${p.version}`, ...(b ? [b.title, `Audience: ${b.audience}`, `Goal: ${b.goal}`, `Constraints: ${b.constraints.join(' · ')}`] : []),
        ...(lead?.doing ? [lead.doing] : []), ...(lead?.helpers ?? []).slice(0, 3).map(h => `${h.title} · ${h.doing ?? ''}`),
        ...((lead?.helpers?.length ?? 0) > 3 ? [`+${lead!.helpers!.length - 3} helpers · E to read all`] : []),
        `Spent $${spend.spent.toFixed(2)} · Reserved $${spend.reserved.toFixed(2)} · Remaining $${spend.remaining.toFixed(2)}`];
      // Readable full text is also available with E; the physical board uses bounded previews.
      this.card('pitch-brief-board', rows.map(s => s.slice(0, 140)).slice(0, 11), B.x, B.y, B.z - .09, B.width, B.height, Math.PI);
    }
    (p.directions ?? []).forEach((d, i) => {
      const card = this.card(`pitch-direction-${d.id}`, [d.title, d.summary.slice(0, 160), p.picked === d.id ? 'Picked' : p.picked ? 'Direction chosen' : 'E · Pick'], R.minX + .12, 1.75, 9 + i * 1.45, 1.25, 1, Math.PI / 2);
      if (d.image) {
        const generation = this.generation;
        new THREE.TextureLoader().load(pitchImageUrl(view!.cubbyId, d.image.hash), tex => {
          if (generation !== this.generation) return tex.dispose();
          this.textures.push(tex); tex.colorSpace = THREE.SRGBColorSpace;
          const image = new THREE.Mesh(new THREE.PlaneGeometry(.9, .4), new THREE.MeshBasicMaterial({ map: tex }));
          image.position.set(0, -.25, .01); card.mesh.add(image);
        }, undefined, () => {});
      }
    });
    const asked = (p.costs ?? []).filter(c => c.status === 'asked');
    const columns = asked.length > 4 ? 6 : 4, rows = Math.ceil(asked.length / columns), height = Math.min(.5, 1.3 / Math.max(1, rows));
    asked.forEach((c, i) => {
      this.card(`pitch-cost-${c.id}`, [c.tool, c.what.slice(0, 50), `$${c.estimate.toFixed(2)} · $${spend.remaining.toFixed(2)} left`, 'E · OK / Decline'],
        T.x - 1.65 + i % columns * (3.4 / columns), T.height + .06, T.z - .6 + Math.floor(i / columns) * height, 3.1 / columns, height * .9, 0, true);
    });
  }
}
