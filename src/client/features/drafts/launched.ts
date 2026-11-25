// What a kicked-off floor keeps, for everyone on it (store.drafts.launched): a "Design" book standing
// face out on the bookshelf (E opens the approved screens and the brand, see ui-design.ts) and a
// framed brand poster hung flat on the elevator's front, beside its doors: the name, the tagline and the
// colors. Both are put away and not usable on any other floor.

import * as THREE from 'three';
import type { Launched } from '../../../shared/protocol/drafts';
import { BOOKSHELF, ELEVATOR, ELEVATOR_FRONT } from '../../../shared/layout';
import type { Fixture } from '../../world/office/fixture';
import { mesh, toon } from '../../world/toon';
import type { Interactable } from '../../world/types';
import { CREAM, FONT, Face, INK } from '../cubbies/props';
import { wrap } from './boards';
import { posterOf } from './kickoff-model';

declare module '../../world/types' {
  interface OfficeHandles {
    /** A kicked-off floor's Design book and brand poster (see features/drafts/launched.ts). */
    launched: LaunchedView;
  }
}

export interface LaunchedView {
  /** What the floor was kicked off with, or undefined to put them away. */
  set(l: Launched | undefined): void;
  /** The Design book, to use with E (off while there's nothing to show). */
  readonly book: Interactable;
  readonly group: THREE.Group;
}

/** Where the Design book stands: face out on the shelf at eye height, toward the shelf's east end. */
export const DESIGN_BOOK = { x: BOOKSHELF.x + 0.42, y: 1.0, z: BOOKSHELF.z - BOOKSHELF.depth / 2 - 0.035, width: 0.34, height: 0.44 } as const;
/**
 * The brand poster: hung flat on the elevator's front, on the strip of wall west of its doors (the call
 * button is on the east strip). Flush with the wall, it can't stand in front of the merge gong (east of
 * the doors) or the PR board (west of the shaft) from any angle, and it's at eye height as you walk up.
 */
const PILLAR = (ELEVATOR.width - ELEVATOR.doorWidth) / 2;
const TRIM = 0.08;
export const POSTER = { x: ELEVATOR.x - ELEVATOR.width / 2 + (PILLAR - TRIM) / 2, z: ELEVATOR_FRONT + 0.03, width: 0.42, height: 0.58, bottom: 1.06 } as const;

const MUTED = '#6c7086';

function swatchRow(c: CanvasRenderingContext2D, colors: readonly string[], cx: number, y: number, maxW: number, most: number) {
  const n = colors.length;
  if (!n) return;
  const gap = most * 0.22;
  const size = Math.min(most, (maxW - gap * (n - 1)) / n);
  const x0 = cx - (n * size + (n - 1) * gap) / 2;
  colors.forEach((col, i) => {
    c.beginPath();
    c.roundRect(x0 + i * (size + gap), y, size, size, size * 0.18);
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = Math.max(3, size * 0.05);
    c.stroke();
  });
}

/** The book's cover: deep blue cloth, "Design" in gold, the brand's name and its colors along the bottom. */
function paintCover(c: CanvasRenderingContext2D, w: number, h: number, l: Launched) {
  c.fillStyle = '#1d3557';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#16294a';
  c.fillRect(0, 0, w * 0.08, h);
  c.strokeStyle = '#e9c46a';
  c.lineWidth = w * 0.02;
  c.strokeRect(w * 0.14, h * 0.05, w * 0.8, h * 0.9);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#e9c46a';
  c.font = FONT(Math.round(w * 0.2), 900);
  c.fillText('Design', w * 0.54, h * 0.24);
  c.fillStyle = CREAM;
  c.font = FONT(Math.round(w * 0.1), 800);
  wrap(c, posterOf(l).name, w * 0.7, 2).forEach((line, i) => c.fillText(line, w * 0.54, h * 0.44 + i * w * 0.12));
  swatchRow(c, l.brand.colors, w * 0.54, h * 0.72, w * 0.66, w * 0.12);
}

/** The poster: cream with an ink frame, the name big, the tagline under it, the colors along the bottom. */
function paintPoster(c: CanvasRenderingContext2D, w: number, h: number, l: Launched) {
  const p = posterOf(l);
  c.fillStyle = CREAM;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = INK;
  c.lineWidth = w * 0.025;
  c.strokeRect(w * 0.05, w * 0.05, w * 0.9, h - w * 0.1);
  // A band of the first color across the top.
  c.fillStyle = p.colors[0] ?? INK;
  c.fillRect(w * 0.05, w * 0.05, w * 0.9, h * 0.16);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.font = FONT(Math.round(w * 0.15), 900);
  wrap(c, p.name, w * 0.8, 2).forEach((line, i, all) => c.fillText(line, w / 2, h * (all.length > 1 ? 0.34 : 0.4) + i * w * 0.17));
  if (p.tagline) {
    c.fillStyle = MUTED;
    c.font = FONT(Math.round(w * 0.065), 700);
    wrap(c, p.tagline, w * 0.78, 3).forEach((line, i) => c.fillText(line, w / 2, h * 0.58 + i * w * 0.085));
  }
  swatchRow(c, p.colors, w / 2, h * 0.8, w * 0.8, w * 0.12);
}

function build(): LaunchedView {
  const group = new THREE.Group();
  group.name = 'launched';
  group.visible = false;

  // The book, standing on the shelf with its cover to the room (-z).
  const book = new THREE.Group();
  book.position.set(DESIGN_BOOK.x, DESIGN_BOOK.y, DESIGN_BOOK.z);
  book.add(mesh(new THREE.BoxGeometry(DESIGN_BOOK.width, DESIGN_BOOK.height, 0.05), toon('#1d3557'), 0, DESIGN_BOOK.height / 2, 0.02, false));
  book.add(mesh(new THREE.BoxGeometry(DESIGN_BOOK.width - 0.03, DESIGN_BOOK.height - 0.02, 0.045), toon('#fffaf3'), 0.012, DESIGN_BOOK.height / 2, 0.022, false));
  const cover = new Face(DESIGN_BOOK.width, DESIGN_BOOK.height, 512);
  cover.mesh.position.set(0, DESIGN_BOOK.height / 2, -0.007);
  cover.mesh.rotation.y = Math.PI;
  book.add(cover.mesh);
  const bookIt: Interactable = { kind: 'designbook', x: DESIGN_BOOK.x, z: DESIGN_BOOK.z - 0.9, radius: 1.3, off: true };
  book.traverse((o) => void (o.userData.interact = bookIt));
  group.add(book);

  // The poster, framed on the elevator's front.
  const wallPoster = new THREE.Group();
  wallPoster.position.set(POSTER.x, 0, POSTER.z);
  wallPoster.add(mesh(new THREE.BoxGeometry(POSTER.width + 0.06, POSTER.height + 0.06, 0.03), toon(INK), 0, POSTER.bottom + POSTER.height / 2, 0, false));
  const poster = new Face(POSTER.width, POSTER.height, 768);
  poster.mesh.position.set(0, POSTER.bottom + POSTER.height / 2, 0.017);
  wallPoster.add(poster.mesh);
  group.add(wallPoster);
  let key = '';

  return {
    group,
    book: bookIt,
    set(l) {
      group.visible = !!l;
      bookIt.off = !l;
      if (!l) return;
      const k = JSON.stringify([l.name, l.brand]);
      if (k === key) return;
      key = k;
      cover.draw(k, (c, w, h) => paintCover(c, w, h, l));
      poster.draw(k, (c, w, h) => paintPoster(c, w, h, l));
    },
  };
}

/** The Design book and the brand poster, put away until the floor you're on was kicked off. */
export const launched: Fixture<'launched'> = () => {
  const built = build();
  return { group: built.group, interactables: [built.book], handle: { launched: built } };
};
