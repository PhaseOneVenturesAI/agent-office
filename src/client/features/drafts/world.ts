// What a draft floor puts in the office: a pale sheet over each covered pod of desks, the studio table
// where the whiteboard stands with its one warm lamp over it, the panels over the boards and the TV
// (boards.ts), the lead (greeting you at the doors, then by the table) and a designer at each pod a
// screen-drawing helper has uncovered. Built once; shown only while you're on a draft of yours.

import * as THREE from 'three';
import type { Look } from '../../../shared/avatar';
import { WALL_HEIGHT } from '../../../shared/layout';
import { AVATAR_COLORS } from '../../state/persist';
import { Person, Worker } from '../../world/character';
import { mesh, roundedBox, textSprite, toon } from '../../world/toon';
import type { Collider, DeskView, Interactable } from '../../world/types';
import { CREAM, INK, disposeTree, simpleDesk } from '../cubbies/props';
import { focusedOf, showTags, type Focus } from '../cubbies/focus';
import { DraftBoardsView } from './boards';
import { LEAD_SPOTS, PODS, STUDIO, type Pod } from './model';

// Pale even with the lights off: a little of their own glow, the way a white sheet catches what light there is.
const SHEET = toon('#ece6db', { emissive: '#5e594f' });
const SHEET_FOLD = toon('#d8cfc1', { emissive: '#4c473f' });
const NOTE_COLORS = ['#fde7a1', '#cfeadc', '#ffd6e0', '#fde7a1', '#d7e3fc'];

/** A sheet thrown over a pod: one soft lump, the chairs' backs pushing it up along each side. */
function cover(p: Pod): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.x, 0, p.z);
  const w = p.width - 0.2;
  const d = p.depth - 1.0;
  g.add(mesh(roundedBox(w, 1.0, d, 0.22), SHEET, 0, 0.5, 0));
  // The skirt, hanging down a little wider than the top.
  g.add(mesh(roundedBox(w + 0.18, 0.32, d + 0.18, 0.12), SHEET_FOLD, 0, 0.16, 0));
  // Chairs under it on both long sides.
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) g.add(mesh(roundedBox(0.62, 0.95, 0.5, 0.2), SHEET, sx * (w / 4), 0.48, sz * (d / 2 + 0.32)));
  // A few folds across the top.
  for (const fx of [-0.3, 0.05, 0.36]) {
    const fold = mesh(roundedBox(0.16, 0.1, d * 0.92, 0.05), SHEET_FOLD, fx * w, 1.01, 0);
    fold.rotation.y = fx * 0.3;
    g.add(fold);
  }
  return g;
}

/** The lamp over the studio table: a cord from the ceiling, a dark shade, a warm bulb, its light and the pool it throws. */
function hangingLamp(): { group: THREE.Group; light: THREE.PointLight; pool: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  g.position.set(STUDIO.x, 0, STUDIO.z);
  const cordLen = WALL_HEIGHT - STUDIO.lampY - 0.3;
  g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, cordLen, 6), toon(INK), 0, STUDIO.lampY + 0.3 + cordLen / 2, 0, false));
  const shade = mesh(new THREE.ConeGeometry(0.55, 0.45, 24, 1, true), toon('#2b2d42'), 0, STUDIO.lampY + 0.12, 0, false);
  (shade.material as THREE.Material).side = THREE.DoubleSide;
  g.add(shade);
  g.add(mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff1c9' }), 0, STUDIO.lampY - 0.05, 0, false));
  const light = new THREE.PointLight('#ffcf8a', LAMP, 7.5, 2);
  light.position.set(0, STUDIO.lampY - 0.2, 0);
  g.add(light);
  // The warm pool on the floor round the table.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,214,150,0.55)');
  grad.addColorStop(0.6, 'rgba(255,200,130,0.22)');
  grad.addColorStop(1, 'rgba(255,200,130,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.02;
  g.add(pool);
  return { group: g, light, pool: poolMat };
}

/** The studio table: a long table with sticky notes on it, and its sign. */
function studioTable(): { group: THREE.Group; sign: THREE.Sprite } {
  const g = simpleDesk(STUDIO.width, STUDIO.depth, STUDIO.height);
  g.position.set(STUDIO.x, 0, STUDIO.z);
  const notes = [[-0.9, -0.25, 0.2], [-0.45, 0.2, -0.15], [0.05, -0.2, 0.1], [0.55, 0.22, 0.3], [0.95, -0.15, -0.2]] as const;
  notes.forEach(([nx, nz, r], i) => {
    const n = mesh(new THREE.BoxGeometry(0.26, 0.01, 0.26), toon(NOTE_COLORS[i]), nx, STUDIO.height + 0.006, nz, false);
    n.rotation.y = r;
    g.add(n);
  });
  const sign = textSprite('✨ Studio table', { bg: CREAM, size: 40 });
  sign.position.set(0, 1.45, 0);
  g.add(sign);
  return { group: g, sign };
}

/** How bright the lamp over the table is. */
const LAMP = 14;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

export interface Designer {
  name: string;
  task: string;
}

export class DraftScene {
  readonly group = new THREE.Group();
  readonly boards = new DraftBoardsView();
  readonly covers = new Map<string, THREE.Group>();
  readonly table: Interactable = { kind: 'studiotable', x: STUDIO.x, z: STUDIO.z + STUDIO.depth / 2 + 0.5, radius: 2.2 };
  readonly leadIt: Interactable = { kind: 'draftlead', x: LEAD_SPOTS.greet.x, z: LEAD_SPOTS.greet.z, radius: 1.2 };
  readonly colliders: Collider[] = [
    { minX: STUDIO.x - STUDIO.width / 2 - 0.05, maxX: STUDIO.x + STUDIO.width / 2 + 0.05, minZ: STUDIO.z - STUDIO.depth / 2 - 0.05, maxZ: STUDIO.z + STUDIO.depth / 2 + 0.05, top: STUDIO.height },
  ];
  readonly lead: Person;
  private bubble: THREE.Sprite | null = null;
  private bubbleText = '';
  private leadKey = '';
  readonly light: THREE.PointLight;
  private designers = new Map<string, { worker: Worker; key: string }>();
  private pool: THREE.MeshBasicMaterial;
  private sign: THREE.Sprite;
  /** Each cover's own see-through copies of the sheets' materials while it flies off (see liftCover). */
  private flying = new Map<string, { mesh: THREE.Mesh; own: THREE.Material; copy: THREE.MeshToonMaterial }[]>();
  /** What was showing when everything but the lead was put away for its walk (see onlyLead). */
  private hidden: { o: THREE.Object3D; was: boolean }[] | null = null;

  constructor() {
    this.group.name = 'drafts';
    for (const p of PODS) {
      const c = cover(p);
      this.covers.set(p.id, c);
      this.group.add(c);
    }
    const table = studioTable();
    table.group.userData.interact = this.table;
    this.sign = table.sign;
    this.group.add(table.group);
    const lamp = hangingLamp();
    this.light = lamp.light;
    this.pool = lamp.pool;
    this.group.add(lamp.group);
    this.group.add(this.boards.group);
    this.lead = new Person('Lead', AVATAR_COLORS[0], { skin: 0, hair: 0, style: 0 });
    this.lead.root.userData.interact = this.leadIt;
    this.group.add(this.lead.root);
  }

  /** The lead's name and look (the look from its cubby, when there is one). */
  setLead(name: string, look: Look | undefined, colorIndex: number) {
    const key = `${name}|${look ? `${look.skin},${look.hair},${look.style}` : ''}`;
    if (key === this.leadKey) return;
    this.leadKey = key;
    if (look) this.lead.setLook(look);
    this.lead.setColor(AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]);
    this.lead.setLabel(name, null);
    this.lead.setDoing('✨ your lead');
  }

  /** The lead's speech bubble over its name tag, or none (''). */
  say(text: string) {
    if (text === this.bubbleText) return;
    this.bubbleText = text;
    if (this.bubble) {
      this.lead.root.remove(this.bubble);
      disposeTree(this.bubble);
      this.bubble = null;
    }
    if (!text) return;
    this.bubble = textSprite(text, { bg: CREAM, size: 30, border: INK });
    this.bubble.position.y = this.lead.bubbleY + 0.1;
    this.lead.root.add(this.bubble);
  }

  /** A designer at the first desk of each uncovered pod (`desks` gives the office's desk by id). */
  setDesigners(pods: readonly Pod[], who: readonly Designer[], owner: string, desk: (id: string) => DeskView | undefined) {
    const want = new Map(pods.map((p, i) => [p.desks[0].id, who[i] ?? { name: 'Designer', task: 'Drawing screens' }]));
    for (const [id, d] of this.designers) {
      if (want.has(id)) continue;
      d.worker.root.removeFromParent();
      d.worker.dispose();
      this.designers.delete(id);
    }
    for (const [id, w] of want) {
      let d = this.designers.get(id);
      if (!d) {
        const view = desk(id);
        if (!view) continue;
        const worker = new Worker(w.name, '#d97757');
        worker.setStatus('working', false);
        view.seatAnchor.add(worker.root);
        d = { worker, key: '' };
        this.designers.set(id, d);
      }
      const key = `${w.name}|${w.task}|${owner}`;
      if (key !== d.key) {
        d.key = key;
        d.worker.setName(w.name);
        d.worker.setOwner(owner);
        d.worker.setTask({ name: w.task, summary: 'Draws screens for your ✓' });
      }
    }
  }

  /** Takes every designer away (on leaving the draft). */
  clearDesigners() {
    this.setDesigners([], [], '', () => undefined);
  }

  update(dt: number, t: number, focus?: Focus) {
    for (const d of this.designers.values()) d.worker.update(dt, t);
    // Only the designer you're aiming at or standing right by shows its tags: they'd cover the boards.
    const at = new THREE.Vector3();
    const all = [...this.designers.values()].map((d) => {
      d.worker.root.getWorldPosition(at);
      return { item: d, x: at.x, z: at.z, interact: d.worker.root.userData.interact };
    });
    const shown = focusedOf(all, focus);
    for (const d of this.designers.values()) showTags(d.worker.root, d === shown);
  }

  // ---- Kickoff (see kickoff.ts) ---------------------------------------------------------------------

  /** The floor's about to change: every cover back on its pod, ready to fly. */
  startKickoff() {
    this.resetCovers();
    // On its way into the cubby hall it's nobody to talk to: the cubby's own lead is.
    this.leadIt.off = true;
    for (const [id, c] of this.covers) {
      const list: { mesh: THREE.Mesh; own: THREE.Material; copy: THREE.MeshToonMaterial }[] = [];
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const own = m.material as THREE.MeshToonMaterial;
        const copy = own.clone();
        copy.transparent = true;
        m.material = copy;
        list.push({ mesh: m, own, copy });
      });
      this.flying.set(id, list);
    }
  }

  /** A cover `k` of the way through flying up and fading (0 on its pod, 1 gone). */
  liftCover(id: string, k: number) {
    const c = this.covers.get(id);
    if (!c || !c.visible || k <= 0) return;
    const e = easeOut(k);
    c.position.y = e * 3.6;
    c.rotation.z = (id.startsWith('w') ? 1 : -1) * e * 0.35;
    c.rotation.x = e * 0.2;
    for (const f of this.flying.get(id) ?? []) f.copy.opacity = 1 - k * k;
    if (k >= 1) c.visible = false;
  }

  /** How much of the draft's panels, the table's sign and its lamp is left (1 all, 0 none). */
  fadeDraft(k: number) {
    this.boards.fade(k);
    this.sign.material.opacity = k;
    this.light.intensity = LAMP * k;
    this.pool.opacity = k;
  }

  /** Everything but the lead put away (on), or back as it was (off): for its walk once the floor's itself again. */
  onlyLead(on: boolean) {
    if (on === !!this.hidden) return;
    if (!on) {
      for (const h of this.hidden!) h.o.visible = h.was;
      this.hidden = null;
      return;
    }
    this.hidden = this.group.children.filter((o) => o !== this.lead.root).map((o) => ({ o, was: o.visible }));
    for (const h of this.hidden) h.o.visible = false;
  }

  /** The kickoff's over: the covers, panels and lamp as a draft has them, ready for the next one. */
  endKickoff() {
    this.leadIt.off = false;
    this.onlyLead(false);
    this.resetCovers();
    this.fadeDraft(1);
  }

  private resetCovers() {
    for (const [id, list] of this.flying) {
      for (const f of list) {
        f.mesh.material = f.own;
        f.copy.dispose();
      }
      this.flying.delete(id);
    }
    for (const c of this.covers.values()) {
      c.position.y = 0;
      c.rotation.set(0, 0, 0);
    }
  }
}
