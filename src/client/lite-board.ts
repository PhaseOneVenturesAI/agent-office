// The Draft board on the 2D view (/lite, cubbies step 5): on a draft floor of yours, a button lists the
// design board's ideas and screens with their thumbnails, and tapping one opens the same card window
// as the 3D office's wall (shared/drafts/card.ts), feedback and all. No three.js and nothing of the 3D office.

import type { Net } from './net';
import { store } from './state';
import { $, h, openModal } from './ui/dom';
import { CARD_BOARD_EMPTY, CARD_BOARD_TITLE, SCREEN_CHIP, boardCards, feedbackBadge, type BoardCard, type CardBoard } from './shared/drafts/board';
import { openDraftCard } from './shared/drafts/card';
import { draftImage, onDraftImage, thumbCanvas } from './shared/drafts/images';

function row(floorId: string, card: BoardCard, open: () => void): HTMLElement {
  const bmp = card.image ? draftImage(floorId, card.image) : null;
  const thumb = bmp ? thumbCanvas(bmp, 128, 'dl-thumb') : h('span.dl-thumb', { 'aria-hidden': 'true' }, bmp === undefined ? '…' : card.board === 'ideas' ? '💡' : '🖼️');
  const chip = card.status ? SCREEN_CHIP[card.status] : undefined;
  const fb = feedbackBadge(card);
  return h(
    'li',
    {},
    h(
      'button.btn.dl-card',
      { type: 'button', onclick: open, 'aria-label': `Open ${card.title}` },
      thumb,
      h(
        'span.dl-text',
        {},
        h('b', {}, card.title),
        card.note ? h('small', {}, card.note) : null,
        chip || fb ? h('span.dl-meta', {}, chip ? h('span.dl-chip', { style: `background:${chip.bg};color:${chip.color}` }, chip.text) : null, fb ? h('span.dl-count', {}, fb) : null) : null,
      ),
    ),
  );
}

/** The list: ideas first, then screens. */
function openBoardList(net: Net, openChat: (cubbyId: string) => void) {
  const body = h('div.body');
  const el = h('div.modal.draft-board', { role: 'dialog', 'aria-label': 'Draft board' }, h('header', {}, h('h2', {}, '🧩 Draft board')), body);
  let key = '';
  const open = (board: CardBoard, id: string) => openDraftCard({ send: (m) => net.send(m), openChat }, board, id);
  const paint = () => {
    const d = store.drafts.here;
    if (!d) {
      key = '';
      return body.replaceChildren(h('p.cb-empty', {}, 'You’re not on a draft of yours any more.'));
    }
    const sections = (['ideas', 'screens'] as const).map((board) => ({ board, cards: boardCards(d.boards, board) }));
    const loaded = (c: BoardCard) => { const i = c.image ? draftImage(d.id, c.image) : null; return i === undefined ? 'l' : i ? 'i' : 't'; };
    const state = sections.flatMap((s) => s.cards.map((c) => [c.id, c.title, c.note, c.status, c.feedback.length, loaded(c)]));
    const k = JSON.stringify([d.id, state]);
    if (k === key) return;
    key = k;
    body.replaceChildren(
      ...sections.flatMap(({ board, cards }) => [
        h('h3', {}, `${CARD_BOARD_TITLE[board]}${cards.length ? ` · ${cards.length}` : ''}`),
        cards.length ? h('ul', {}, ...cards.map((c) => row(d.id, c, () => open(board, c.id)))) : h('p.cb-empty', {}, CARD_BOARD_EMPTY[board]),
      ]),
    );
  };
  const offs = [store.on('drafts', paint), onDraftImage(paint)];
  paint();
  openModal(el, { doing: '🧩 looking at the draft board', onClose: () => { for (const off of offs) off(); } });
}

export function installLiteBoard(net: Net, openChat: (cubbyId: string) => void) {
  const button = $('btn-board') as HTMLButtonElement;
  const render = () => {
    const d = store.drafts.here;
    button.classList.toggle('hidden', !d);
    // How many cards are up, counted on the button the way the boards count theirs.
    const n = d ? [...d.boards.ideas, ...d.boards.screens].length : 0;
    button.querySelector('.n')!.textContent = n ? String(n) : '';
  };
  button.addEventListener('click', () => openBoardList(net, openChat));
  store.on('drafts', render);
  store.on('floor', render);
  render();
}
