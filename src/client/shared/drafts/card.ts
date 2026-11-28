import './card.css';
import { openStudioCard } from '../studio/review';
import type { ClientMsg } from '../../../shared/protocol';
import { DRAFT_LIMITS } from '../../../shared/protocol/drafts';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import { clip } from '../cubby/text';
import { CARD_BOARD_TITLE, SCREEN_CHIP, boardCards, feedbackLanded, feedbackTime, findCard, type BoardCard, type CardBoard } from './board';
import { draftImage, imageCanvas, onDraftImage } from './images';

// One card of the design board, opened big (cubbies step 5): its image (or its words, when it has
// none or the image wouldn't load), title, status and note, every feedback note left on it, newest
// last, and an owner-account feedback box. A note only shows once the
// owner's computer has saved it and reported it back in the boards; until then it says "Sending…".
// The 3D office opens it from the wall (E on a card), the phone (/lite) from its Draft board.
// Everything shown is put in as text, never as HTML.

export interface CardWindowDeps {
  send(msg: ClientMsg): void;
  /** Opens the existing lead thread. */
  openChat?(cubbyId: string): void;
  /** Puts the cursor in the box straight away (the 3D office; on a phone it'd pop the keyboard up). */
  focus?: boolean;
}

/** How long to wait for the computer to report a note before saying it didn't. */
const CONFIRM_MS = 20_000;

interface Pending {
  board: CardBoard;
  cardId: string;
  requestId: string;
  text: string;
  /** The card's notes when it was sent: the new one is the one that wasn't there. */
  before: Set<string>;
  failed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export function openDraftCard(deps: CardWindowDeps, board: CardBoard, cardId: string): Modal {
  if (store.drafts.here?.studio) return openStudioCard(deps.send, board, cardId);
  let at = { board, id: cardId };
  const title = h('h2');
  const chip = h('span.dc-chip');
  const figure = h('div.dc-figure');
  const note = h('p.dc-note');
  const log = h('ol.dc-log', { 'aria-live': 'polite', 'aria-label': 'Feedback' });
  const status = h('p.cb-note.dc-status', { role: 'status' });
  const text = h('textarea', { rows: 2, maxlength: DRAFT_LIMITS.feedbackText, 'aria-label': 'Your feedback' }) as HTMLTextAreaElement;
  const send = h('button.btn.primary', { type: 'submit' }, 'Send feedback');
  const form = h('form.dc-send', {}, text, send) as HTMLFormElement;
  const chatBtn = h('button.btn.small.dc-chat', { type: 'button' }, '💬 Open lead chat');
  const prev = h('button.btn.small', { type: 'button', 'aria-label': 'Previous card' }, '‹');
  const next = h('button.btn.small', { type: 'button', 'aria-label': 'Next card' }, '›');
  const where = h('span.dc-where');
  const el = h(
    'div.modal.draft-card',
    { role: 'dialog', 'aria-label': 'Design card' },
    h('header', {}, title, chip),
    h('div.body.dc-body', {}, figure, h('div.dc-side', {}, note, h('h3', {}, 'Feedback'), log, status, chatBtn, form)),
    h('footer.dc-nav', {}, prev, where, next),
  );

  const account = store.me.account?.name;
  let sendError = '';
  let sending = false;
  let closed = false;
  let pending: Pending | undefined;
  let figureKey = '';
  let logKey = '';

  const draft = () => store.drafts.here;
  const cards = () => { const d = draft(); return d ? boardCards(d.boards, at.board) : []; };
  const go = (step: number) => {
    const list = cards();
    const i = list.findIndex((c) => c.id === at.id);
    if (i < 0 || !list.length) return;
    at = { board: at.board, id: list[(i + step + list.length) % list.length].id };
    paint();
  };
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));

  function paintFigure(d: NonNullable<ReturnType<typeof draft>>, card: BoardCard) {
    const bmp = card.image ? draftImage(d.id, card.image) : null;
    const k = `${card.board}/${card.id}|${card.image?.hash ?? ''}|${bmp === undefined ? 'loading' : bmp ? 'img' : 'text'}|${card.title}|${card.note ?? ''}`;
    if (k === figureKey) return;
    figureKey = k;
    if (bmp) return figure.replaceChildren(imageCanvas(bmp, 'dc-image'));
    if (bmp === undefined) return figure.replaceChildren(h('div.dc-loading', {}, 'Loading the image…'));
    figure.replaceChildren(h('div.dc-textcard', { class: card.board }, h('b', {}, card.title), card.note ? h('span', {}, card.note) : null));
  }

  function paintLog(card: BoardCard) {
    const mine = pending && pending.board === card.board && pending.cardId === card.id ? pending : undefined;
    const k = `${card.board}/${card.id}|${card.feedback.map((f) => f.id).join(',')}|${mine ? `${mine.requestId}:${mine.failed}` : ''}`;
    if (k === logKey) return;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    logKey = k;
    const items = card.feedback.map((f) => h('li.dc-fb', {}, h('span', {}, f.text), h('time', { datetime: new Date(f.at || 0).toISOString() }, feedbackTime(f.at))));
    if (mine) items.push(h('li.dc-fb.pending', { class: mine.failed ? 'failed' : '' }, h('span', {}, mine.text), h('time', {}, mine.failed ? 'Not saved' : 'Sending…')));
    log.replaceChildren(...(items.length ? items : [h('li.cb-empty', {}, 'No feedback yet. Say what you like or what to change.')]));
    if (atEnd || mine) log.scrollTop = log.scrollHeight;
  }

  function paint() {
    if (closed) return;
    const d = draft();
    const card = findCard(d?.boards, at.board, at.id);
    if (!d || !card) {
      title.textContent = CARD_BOARD_TITLE[at.board];
      chip.textContent = '';
      chip.style.display = 'none';
      figure.replaceChildren(h('p.cb-empty', {}, 'This card is no longer on the board.'));
      figureKey = logKey = '';
      note.textContent = '';
      log.replaceChildren();
      status.textContent = '';
      chatBtn.style.display = 'none';
      form.style.display = 'none';
      prev.disabled = next.disabled = true;
      where.textContent = '';
      return;
    }
    if (pending && pending.board === card.board && pending.cardId === card.id && !pending.failed && feedbackLanded(card, pending)) {
      clearTimeout(pending.timer);
      pending = undefined;
    }
    title.textContent = card.title;
    const c = card.status ? SCREEN_CHIP[card.status] : undefined;
    chip.textContent = c ? c.text : '💡 idea';
    chip.style.cssText = c ? `background:${c.bg};color:${c.color}` : '';
    paintFigure(d, card);
    note.textContent = card.note ?? '';
    note.style.display = card.note ? '' : 'none';
    paintLog(card);
    const list = cards();
    const i = list.findIndex((x) => x.id === card.id);
    where.textContent = `${CARD_BOARD_TITLE[card.board]} · ${i + 1} of ${list.length}`;
    prev.disabled = next.disabled = list.length < 2;

    const sameAccount = store.me.account?.name === account;
    const asleep = !d.online;
    status.textContent = !sameAccount ? 'Account changed. Close and reopen this card.' : sendError || (asleep ? 'Your Mac link is offline or this project has no linked lead.' : pending?.failed ? 'Your Mac did not confirm this note. Check the lead chat before retrying.' : '');
    status.style.display = status.textContent ? '' : 'none';
    chatBtn.style.display = 'none';
    form.style.display = sameAccount ? '' : 'none';
    const sendingHere = !!pending && !pending.failed;
    text.disabled = asleep || sending;
    send.disabled = asleep || sending || sendingHere;
    send.textContent = sending || sendingHere ? 'Sending…' : 'Send feedback';
    text.placeholder = `Feedback on ${clip(card.title, 40)}…`;

  }

  chatBtn.addEventListener('click', () => {
    const id = draft()?.cubbyId;
    if (id) deps.openChat?.(id);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = draft();
    const card = findCard(d?.boards, at.board, at.id);
    const body = text.value.replace(/\r\n?/g, '\n').trim().slice(0, DRAFT_LIMITS.feedbackText);
    if (!body || !d || !card || !d.online || sending || (pending && !pending.failed) || store.me.account?.name !== account) return;
    sending = true;
    paint();
    try {
      const feedback = { cardId: card.id, text: body, requestId: crypto.randomUUID(), at: Date.now() };
      if (pending) clearTimeout(pending.timer);
      const p: Pending = {
        board: card.board, cardId: card.id, requestId: feedback.requestId, text: body, before: new Set(card.feedback.map((f) => f.id)), failed: false,
        timer: setTimeout(() => {
          if (pending !== p) return;
          p.failed = true;
          if (!text.value) text.value = p.text;
          paint();
        }, CONFIRM_MS),
      };
      pending = p;
      deps.send({ t: 'drafts.feedback', floorId: d.id, ...feedback });
      text.value = '';
    } catch {
      sendError = 'Could not send this note. Reopen the card and try again.';
    } finally {
      sending = false;
      paint();
    }
  });
  // Enter sends, Shift+Enter is a new line; the game doesn't get the keys while you type.
  text.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  text.addEventListener('keyup', (e) => e.stopPropagation());

  const offs = [store.on('drafts', paint), store.on('cubbies', paint), onDraftImage(paint)];
  paint();
  const modal = openModal(el, {
    doing: '🖼️ looking at the design board',
    onClose: () => {
      closed = true;
      if (pending) clearTimeout(pending.timer);
      for (const off of offs) off();
    },
  });
  if (deps.focus) setTimeout(() => { if (!text.disabled) text.focus(); }, 30);
  return modal;
}
