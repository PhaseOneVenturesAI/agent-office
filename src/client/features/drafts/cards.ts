// The design board's cards as the wall paints them (cubbies step 5): on the Ideas and Screens panels,
// three across and two down, each with its design image as a thumbnail (or its words when it has none,
// or the image wouldn't load), its title, a screen's status chip, and a 💬 count once it has feedback.
// With more cards than fit, the last place says how many more, and opens the first of them.

import { FONT, INK } from '../cubbies/props';
import { SCREEN_CHIP, feedbackBadge, type BoardCard } from '../../shared/drafts/board';
import { drawCover } from '../../shared/drafts/images';
import { cardRects, shown } from './model';

const MUTED = '#6c7086';
const IDEA_NOTE = '#fde7a1';

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

/** One place on the panel: which card E there opens (the first one that didn't fit, for "+N more"). */
export interface CardSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  cardId: string;
  title: string;
  more: number;
}

/** Where the cards go and which is where, without painting (the hit areas use the same). */
export function cardSlots(w: number, h: number, top: number, cards: readonly BoardCard[]): CardSlot[] {
  const rects = cardRects(w, h, top);
  const { items, more } = shown(cards, rects.length);
  const slots: CardSlot[] = items.map((card, i) => ({ ...rects[i], cardId: card.id, title: card.title, more: 0 }));
  if (more) {
    const first = cards[items.length];
    slots.push({ ...rects[items.length], cardId: first.id, title: first.title, more });
  }
  return slots;
}

function badge(c: CanvasRenderingContext2D, text: string, right: number, y: number) {
  c.font = FONT(32, 900);
  const tw = c.measureText(text).width + 32;
  roundRect(c, right - tw, y, tw, 50, 25);
  c.fillStyle = INK;
  c.fill();
  c.fillStyle = '#fff8e8';
  c.textBaseline = 'middle';
  c.fillText(text, right - tw + 16, y + 26);
}

function chip(c: CanvasRenderingContext2D, status: NonNullable<BoardCard['status']>, x: number, y: number) {
  const ch = SCREEN_CHIP[status];
  c.font = FONT(30);
  const tw = c.measureText(ch.text).width + 32;
  roundRect(c, x, y, tw, 46, 23);
  c.fillStyle = ch.bg;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.stroke();
  c.fillStyle = ch.color;
  c.textBaseline = 'middle';
  c.fillText(ch.text, x + 16, y + 24);
}

/** One card: `img` is its image (null: none, or it wouldn't load; undefined: still loading). */
function paintCard(c: CanvasRenderingContext2D, s: CardSlot, card: BoardCard, img: ImageBitmap | null | undefined) {
  const { x, y, w, h } = s;
  const words = !img && img !== undefined && card.board === 'ideas';
  roundRect(c, x, y, w, h, 18);
  c.fillStyle = words ? IDEA_NOTE : '#ffffff';
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 5;
  c.stroke();
  c.textAlign = 'left';
  if (words) {
    // An idea with no picture: its words, a sticky note.
    c.fillStyle = INK;
    c.font = FONT(44, 900);
    c.textBaseline = 'top';
    const head = wrap(c, card.title, w - 44, 2);
    head.forEach((l, i) => c.fillText(l, x + 22, y + 24 + i * 52));
    if (card.note) {
      c.font = FONT(32, 700);
      c.fillStyle = '#3d405b';
      const room = Math.max(1, Math.floor((h - 60 - head.length * 52 - 70) / 40));
      wrap(c, card.note, w - 44, room).forEach((l, i) => c.fillText(l, x + 22, y + 40 + head.length * 52 + i * 40));
    }
  } else {
    const th = Math.round(h * 0.6);
    const tx = x + 16;
    const ty = y + 16;
    const tw = w - 32;
    c.save();
    roundRect(c, tx, ty, tw, th, 10);
    c.clip();
    c.fillStyle = '#e9ecef';
    c.fillRect(tx, ty, tw, th);
    if (img) drawCover(c, img, tx, ty, tw, th);
    else {
      c.fillStyle = MUTED;
      c.font = FONT(30, 800);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(img === undefined ? 'Loading…' : card.board === 'ideas' ? '💡' : '🖼️', tx + tw / 2, ty + th / 2);
      c.textAlign = 'left';
    }
    c.restore();
    c.strokeStyle = INK;
    c.lineWidth = 3;
    roundRect(c, tx, ty, tw, th, 10);
    c.stroke();
    c.fillStyle = INK;
    c.font = FONT(38);
    c.textBaseline = 'top';
    c.fillText(wrap(c, card.title, w - 40, 1)[0] ?? '', x + 20, ty + th + 14);
    if (card.status) chip(c, card.status, x + 20, y + h - 60);
    else if (card.note) {
      c.font = FONT(28, 700);
      c.fillStyle = MUTED;
      c.fillText(wrap(c, card.note, w - 40 - (card.feedback.length ? 130 : 0), 1)[0] ?? '', x + 20, ty + th + 60);
    }
  }
  const fb = feedbackBadge(card);
  if (fb) badge(c, fb, x + w - 14, y + h - 64);
}

/** The cards on a panel, below `top`; `img` gives each card's image as it stands. */
export function paintCards(c: CanvasRenderingContext2D, w: number, h: number, top: number, cards: readonly BoardCard[], img: (card: BoardCard) => ImageBitmap | null | undefined) {
  for (const s of cardSlots(w, h, top, cards)) {
    const card = s.more ? undefined : cards.find((x) => x.id === s.cardId);
    if (card) {
      paintCard(c, s, card, img(card));
      continue;
    }
    roundRect(c, s.x, s.y, s.w, s.h, 18);
    c.setLineDash([18, 14]);
    c.strokeStyle = MUTED;
    c.lineWidth = 5;
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = MUTED;
    c.font = FONT(48);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(`+${s.more} more`, s.x + s.w / 2, s.y + s.h / 2);
    c.textAlign = 'left';
  }
}
