// What the boards show on a draft: cream panels with the office's dark sign pill for a title, over the
// Issues, Task queue and PR boards (Decisions, Plan and Screens), the Ideas board over the Services
// board on the east wall (step 5), and the Brand wall over the TV beside it. Each is a canvas, redrawn
// only when what it shows changes; everything on it is text the page was sent, drawn as text, and the
// design images the owner's own page loaded (shared/drafts/images.ts). Each card on the Ideas and
// Screens boards has a see-through patch in front of it that the aim lands on, for E to open it.

import * as THREE from 'three';
import type { DraftBoards } from '../../../shared/protocol/drafts';
import { BOARDS, TV } from '../../../shared/layout';
import type { Interactable } from '../../world/types';
import { boardCards, type CardBoard } from '../../shared/drafts/board';
import { draftImage } from '../../shared/drafts/images';
import { CREAM, FONT, Face, INK } from '../cubbies/props';
import { cardSlots, paintCards, roundRect, wrap, type CardSlot } from './cards';
import { BRAND_EMPTY, BRAND_TITLE, CARD_GRID, DRAFT_BOARDS, IDEAS_BOARD, boardLines, brandEmpty, shown, type BoardKey } from './model';

export { wrap };

const NOTE_COLORS = ['#fde7a1', '#cfeadc', '#ffd6e0', '#d7e3fc'];
const MUTED = '#6c7086';

/** The panel: cream with a thick ink edge, and the dark sign pill with the title across its top. */
function panel(c: CanvasRenderingContext2D, w: number, h: number, title: string): number {
  c.fillStyle = CREAM;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = INK;
  c.lineWidth = 14;
  c.strokeRect(7, 7, w - 14, h - 14);
  c.font = FONT(58);
  const pw = c.measureText(title).width + 90;
  roundRect(c, (w - pw) / 2, 34, pw, 92, 46);
  c.fillStyle = INK;
  c.fill();
  c.fillStyle = CREAM;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(title, w / 2, 82);
  c.textAlign = 'left';
  return 160;
}

function emptyNote(c: CanvasRenderingContext2D, w: number, h: number, top: number, text: string) {
  c.fillStyle = MUTED;
  c.font = FONT(70, 800);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const lines = wrap(c, text, w - 260, 3);
  lines.forEach((l, i) => c.fillText(l, w / 2, (top + h) / 2 - ((lines.length - 1) * 88) / 2 + i * 88));
  c.textAlign = 'left';
}

/** Decisions as sticky notes, three across. */
function paintDecisions(c: CanvasRenderingContext2D, w: number, h: number, top: number, lines: string[]) {
  const cols = 3;
  const rows = 3;
  const gap = 34;
  const nw = (w - 80 - gap * (cols - 1)) / cols;
  const nh = (h - top - 50 - gap * (rows - 1)) / rows;
  const { items, more } = shown(lines, cols * rows);
  items.forEach((text, i) => {
    const x = 40 + (i % cols) * (nw + gap);
    const y = top + Math.floor(i / cols) * (nh + gap);
    c.fillStyle = NOTE_COLORS[i % NOTE_COLORS.length];
    c.fillRect(x, y, nw, nh);
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.strokeRect(x, y, nw, nh);
    c.fillStyle = INK;
    c.font = FONT(40, 800);
    c.textBaseline = 'top';
    wrap(c, text, nw - 40, 3).forEach((l, j) => c.fillText(l, x + 20, y + 18 + j * 48));
  });
  if (more) {
    c.fillStyle = MUTED;
    c.font = FONT(44);
    c.textBaseline = 'middle';
    c.fillText(`+${more} more`, 40 + (items.length % cols) * (nw + gap) + 20, top + Math.floor(items.length / cols) * (nh + gap) + nh / 2);
  }
}

/** The plan as a numbered list. */
function paintPlan(c: CanvasRenderingContext2D, w: number, h: number, top: number, lines: string[]) {
  const row = 92;
  const { items, more } = shown(lines, Math.floor((h - top - 30) / row));
  c.textBaseline = 'middle';
  items.forEach((text, i) => {
    const y = top + i * row + row / 2 - 10;
    c.fillStyle = INK;
    c.beginPath();
    c.arc(90, y, 32, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = CREAM;
    c.font = FONT(40);
    c.textAlign = 'center';
    c.fillText(String(i + 1), 90, y + 2);
    c.textAlign = 'left';
    c.fillStyle = INK;
    c.font = FONT(48, 700);
    c.fillText(wrap(c, text, w - 220, 1)[0] ?? '', 150, y);
  });
  if (more) {
    c.fillStyle = MUTED;
    c.font = FONT(44);
    c.fillText(`+${more} more`, 150, top + items.length * row + row / 2 - 10);
  }
}

/** The Brand wall: the name, the tagline and the colors. */
function paintBrand(c: CanvasRenderingContext2D, w: number, h: number, b: DraftBoards['brand']) {
  const top = panel(c, w, h, BRAND_TITLE);
  if (brandEmpty(b)) return emptyNote(c, w, h, top, BRAND_EMPTY);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.font = FONT(120, 900);
  if (b.name) c.fillText(wrap(c, b.name, w - 160, 1)[0] ?? '', w / 2, top + 110);
  c.font = FONT(50, 700);
  c.fillStyle = MUTED;
  if (b.tagline) wrap(c, b.tagline, w - 200, 2).forEach((l, i) => c.fillText(l, w / 2, top + 220 + i * 62));
  c.textAlign = 'left';
  const n = b.colors.length;
  if (!n) return;
  const size = Math.min(150, (w - 160) / n - 30);
  const x0 = (w - n * size - (n - 1) * 30) / 2;
  const y = h - size - 90;
  b.colors.forEach((color, i) => {
    const x = x0 + i * (size + 30);
    roundRect(c, x, y, size, size, 22);
    c.fillStyle = color;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 6;
    c.stroke();
    c.fillStyle = INK;
    c.font = FONT(30, 700);
    c.textAlign = 'center';
    c.fillText(color.toUpperCase(), x + size / 2, y + size + 40);
    c.textAlign = 'left';
  });
}

/** How wide each panel's canvas is, and where its cards start below the title. */
const PANEL_PX = 1536;
const TOP = 160;

/** How tall a panel's canvas is (as Face makes it). */
const pxHeight = (f: Face) => Math.round((PANEL_PX * f.mesh.geometry.parameters.height) / f.mesh.geometry.parameters.width);

/** One card's patch in front of a panel: what the aim lands on, and the card it opens. */
interface Hit {
  mesh: THREE.Mesh;
  it: Interactable;
  slot?: CardSlot;
}

/** The panels, put up over the boards and the TV. */
export class DraftBoardsView {
  readonly group = new THREE.Group();
  private faces = new Map<BoardKey | 'ideas' | 'brand', Face>();
  private hits = new Map<CardBoard, Hit[]>();
  private hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  private shownK = 1;
  private last: { b: DraftBoards; floorId: string } | undefined;

  constructor() {
    for (const d of DRAFT_BOARDS) {
      const b = BOARDS[d.at];
      // Over the board, its cards and its label above it, and out in front of all of them.
      const f = new Face(b.width + 0.4, b.height + 1.4, PANEL_PX);
      f.mesh.position.set(b.x, b.y + 0.55, b.z + 0.4);
      this.group.add(f.mesh);
      this.faces.set(d.key, f);
    }
    // The Ideas board on the east wall, facing into the room the way the Services board does.
    const s = BOARDS[IDEAS_BOARD.at];
    const ideas = new Face(s.width + 0.4, s.height + 1.4, PANEL_PX);
    ideas.mesh.position.set(s.x - 0.4, s.y + 0.55, s.z);
    ideas.mesh.rotation.y = s.rotY;
    this.group.add(ideas.mesh);
    this.faces.set('ideas', ideas);
    const tv = new Face(TV.width + 0.1, TV.height + 0.1, PANEL_PX);
    tv.mesh.position.set(TV.x - 0.3, TV.y, TV.z);
    tv.mesh.rotation.y = -Math.PI / 2;
    this.group.add(tv.mesh);
    this.faces.set('brand', tv);
    for (const f of this.faces.values()) f.mesh.name = 'draft-board';
    this.group.updateMatrixWorld(true);
    for (const board of ['ideas', 'screens'] as const) this.hits.set(board, this.makeHits(board));
  }

  /** Six patches in front of a card board, one per place on its grid. */
  private makeHits(board: CardBoard): Hit[] {
    const face = this.faces.get(board)!;
    const out: Hit[] = [];
    const at = new THREE.Vector3();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(face.mesh.quaternion);
    for (let i = 0; i < CARD_GRID.cols * CARD_GRID.rows; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.hitMat);
      mesh.name = `draft-card-${board}-${i}`;
      mesh.visible = false;
      face.mesh.add(mesh);
      mesh.position.z = 0.02;
      mesh.getWorldPosition(at);
      const it: Interactable = { kind: 'draftcard', x: at.x + normal.x * 0.3, z: at.z + normal.z * 0.3, radius: 1.3, off: true };
      mesh.userData.interact = it;
      out.push({ mesh, it });
    }
    return out;
  }

  /** Puts each patch over its card (or away, with no card there). */
  private placeHits(board: CardBoard, slots: CardSlot[]) {
    const face = this.faces.get(board)!;
    const g = face.mesh.geometry.parameters;
    const pxH = pxHeight(face);
    const at = new THREE.Vector3();
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(face.mesh.quaternion);
    this.hits.get(board)!.forEach((hit, i) => {
      const s = slots[i];
      hit.slot = s;
      hit.mesh.visible = !!s;
      hit.it.off = !s || this.shownK < 1;
      if (!s) return;
      hit.mesh.scale.set((s.w / PANEL_PX) * g.width, (s.h / pxH) * g.height, 1);
      hit.mesh.position.x = ((s.x + s.w / 2) / PANEL_PX - 0.5) * g.width;
      hit.mesh.position.y = (0.5 - (s.y + s.h / 2) / pxH) * g.height;
      hit.mesh.updateMatrixWorld(true);
      hit.mesh.getWorldPosition(at);
      hit.it.x = at.x + normal.x * 0.3;
      hit.it.z = at.z + normal.z * 0.3;
    });
  }

  /** The cards' patches you can use right now. */
  interactables(): Interactable[] {
    return [...this.hits.values()].flat().filter((h) => !h.it.off).map((h) => h.it);
  }

  /** The card a patch opens. */
  cardAt(it: Interactable): { board: CardBoard; cardId: string; title: string; more: number } | undefined {
    for (const [board, list] of this.hits) {
      const s = list.find((h) => h.it === it)?.slot;
      if (s) return { board, cardId: s.cardId, title: s.title, more: s.more };
    }
    return undefined;
  }

  sync(b: DraftBoards, floorId: string) {
    this.last = { b, floorId };
    for (const d of DRAFT_BOARDS) {
      if (d.key === 'screens') continue;
      const lines = boardLines(b, d.key);
      this.faces.get(d.key)!.draw(JSON.stringify(lines), (c, w, h) => {
        const top = panel(c, w, h, d.title);
        if (!lines.length) return emptyNote(c, w, h, top, d.empty);
        if (d.key === 'decisions') paintDecisions(c, w, h, top, lines);
        else paintPlan(c, w, h, top, lines);
      });
    }
    for (const board of ['screens', 'ideas'] as const) {
      const cards = boardCards(b, board);
      const def = board === 'ideas' ? IDEAS_BOARD : DRAFT_BOARDS.find((d) => d.key === 'screens')!;
      const face = this.faces.get(board)!;
      const slots = cardSlots(PANEL_PX, pxHeight(face), TOP, cards);
      // Each image as it stands (loading, in, or not coming), so the panel redraws once it's in.
      const img = (card: (typeof cards)[number]) => (card.image ? draftImage(floorId, card.image) : null);
      const state = slots.map((s) => {
        const card = s.more ? undefined : cards.find((x) => x.id === s.cardId);
        const i = card ? img(card) : null;
        return i === undefined ? 'l' : i ? 'i' : 't';
      });
      const key = JSON.stringify([floorId, slots.map((s) => [s.cardId, s.more]), cards.slice(0, slots.length).map((c) => [c.title, c.note, c.status, c.image?.hash, c.feedback.length]), state]);
      face.draw(key, (c, w, h) => {
        const top = panel(c, w, h, def.title);
        if (!cards.length) return emptyNote(c, w, h, top, def.empty);
        paintCards(c, w, h, top, cards, img);
      });
      this.placeHits(board, slots);
    }
    this.faces.get('brand')!.draw(JSON.stringify(b.brand), (c, w, h) => paintBrand(c, w, h, b.brand));
  }

  /** Draws again with what's loaded now (an image came in). */
  refresh() {
    if (this.last) this.sync(this.last.b, this.last.floorId);
  }

  /** How much of the panels is left (1 all there, 0 gone): they fade as a draft's kicked off. */
  fade(k: number) {
    this.shownK = k;
    for (const f of this.faces.values()) {
      f.mesh.material.transparent = k < 1;
      f.mesh.material.opacity = k;
      f.mesh.visible = k > 0;
    }
    for (const list of this.hits.values()) for (const h of list) h.it.off = !h.slot || k < 1;
  }

  dispose() {
    for (const f of this.faces.values()) f.dispose();
    for (const list of this.hits.values()) for (const h of list) h.mesh.geometry.dispose();
    this.hitMat.dispose();
  }
}
