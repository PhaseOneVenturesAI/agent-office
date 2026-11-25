// What the north boards and the TV wall show on a draft: cream panels with the office's dark sign pill
// for a title, over the Issues, Task queue and PR boards (Decisions, Plan and Screens), and the Brand
// wall over the TV. Each is a canvas, redrawn only when what it shows changes; everything on it is text
// the page was sent, drawn as text.

import * as THREE from 'three';
import type { DraftBoards } from '../../../shared/protocol/drafts';
import { BOARDS, TV } from '../../../shared/layout';
import { CREAM, FONT, Face, INK } from '../cubbies/props';
import { BRAND_EMPTY, BRAND_TITLE, DRAFT_BOARDS, SCREEN_CHIP, boardLines, brandEmpty, shown, type BoardKey } from './model';

const NOTE_COLORS = ['#fde7a1', '#cfeadc', '#ffd6e0', '#d7e3fc'];
const MUTED = '#6c7086';

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Words wrapped to `maxW`, at most `lines` lines, the last cut with an ellipsis. */
export function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= maxW) line = next;
    else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] += '…';
  }
  return out.map((l) => {
    let t = l;
    while (t.length > 1 && c.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
    return t;
  });
}

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

/** Screens as cards, each with its status chip. */
function paintScreens(c: CanvasRenderingContext2D, w: number, h: number, top: number, b: DraftBoards) {
  const cols = 3;
  const rows = 2;
  const gap = 36;
  const cw = (w - 80 - gap * (cols - 1)) / cols;
  const ch = (h - top - 50 - gap * (rows - 1)) / rows;
  const { items, more } = shown(b.screens, cols * rows);
  items.forEach((s, i) => {
    const x = 40 + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    c.fillStyle = '#ffffff';
    roundRect(c, x, y, cw, ch, 18);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 5;
    c.stroke();
    // A little window frame: the screen it stands for.
    c.fillStyle = '#e9ecef';
    c.fillRect(x + 20, y + 20, cw - 40, ch * 0.34);
    c.fillStyle = INK;
    c.font = FONT(40);
    c.textBaseline = 'top';
    c.fillText(wrap(c, s.title, cw - 40, 1)[0] ?? '', x + 20, y + 30 + ch * 0.34);
    const chip = SCREEN_CHIP[s.status];
    c.font = FONT(32);
    const tw = c.measureText(chip.text).width + 36;
    roundRect(c, x + 20, y + ch - 66, tw, 48, 24);
    c.fillStyle = chip.bg;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = chip.color;
    c.textBaseline = 'middle';
    c.fillText(chip.text, x + 38, y + ch - 41);
  });
  if (more) {
    c.fillStyle = MUTED;
    c.font = FONT(44);
    c.textBaseline = 'middle';
    c.fillText(`+${more} more`, 40 + (items.length % cols) * (cw + gap) + 20, top + Math.floor(items.length / cols) * (ch + gap) + ch / 2);
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

/** The four panels, put up over the boards and the TV. */
export class DraftBoardsView {
  readonly group = new THREE.Group();
  private faces = new Map<BoardKey | 'brand', Face>();

  constructor() {
    for (const d of DRAFT_BOARDS) {
      const b = BOARDS[d.at];
      // Over the board, its cards and its label above it, and out in front of all of them.
      const f = new Face(b.width + 0.4, b.height + 1.4, 1536);
      f.mesh.position.set(b.x, b.y + 0.55, b.z + 0.4);
      this.group.add(f.mesh);
      this.faces.set(d.key, f);
    }
    const tv = new Face(TV.width + 0.1, TV.height + 0.1, 1536);
    tv.mesh.position.set(TV.x - 0.3, TV.y, TV.z);
    tv.mesh.rotation.y = -Math.PI / 2;
    this.group.add(tv.mesh);
    this.faces.set('brand', tv);
    for (const f of this.faces.values()) f.mesh.name = 'draft-board';
  }

  sync(b: DraftBoards) {
    for (const d of DRAFT_BOARDS) {
      const lines = boardLines(b, d.key);
      const key = d.key === 'screens' ? JSON.stringify(b.screens) : JSON.stringify(lines);
      this.faces.get(d.key)!.draw(key, (c, w, h) => {
        const top = panel(c, w, h, d.title);
        if (!lines.length) return emptyNote(c, w, h, top, d.empty);
        if (d.key === 'decisions') paintDecisions(c, w, h, top, lines);
        else if (d.key === 'plan') paintPlan(c, w, h, top, lines);
        else paintScreens(c, w, h, top, b);
      });
    }
    this.faces.get('brand')!.draw(JSON.stringify(b.brand), (c, w, h) => paintBrand(c, w, h, b.brand));
  }

  /** How much of the panels is left (1 all there, 0 gone): they fade as a draft's kicked off. */
  fade(k: number) {
    for (const f of this.faces.values()) {
      f.mesh.material.transparent = k < 1;
      f.mesh.material.opacity = k;
      f.mesh.visible = k > 0;
    }
  }

  dispose() {
    for (const f of this.faces.values()) f.dispose();
  }
}
