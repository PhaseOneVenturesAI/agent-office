import './card.css';
import { openStudioCard } from '../studio/review';
import type { ClientMsg } from '../../../shared/protocol';
import { DRAFT_LIMITS } from '../../../shared/protocol/drafts';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import { deviceTrusted } from '../cubby/devices';
import { ownerDeviceKey, signOwnerFeedback, type OwnerDeviceKey } from '../cubby/keys';
import { clip } from '../cubby/text';
import { CARD_BOARD_TITLE, SCREEN_CHIP, boardCards, feedbackLanded, feedbackTime, findCard, type BoardCard, type CardBoard } from './board';
import { draftImage, imageCanvas, onDraftImage } from './images';

// One card of the design board, opened big (cubbies step 5): its image (or its words, when it has
// none or the image wouldn't load), title, status and note, every feedback note left on it, newest
// last, and a box to leave one. A note is signed with this browser's owner key and only shows once the
// owner's computer has saved it and reported it back in the boards; until then it says "Sending…".
// The 3D office opens it from the wall (E on a card), the phone (/lite) from its Draft board.
// Everything shown is put in as text, never as HTML.

export interface CardWindowDeps {
  send(msg: ClientMsg): void;
  /** Opens the lead's chat (where 📱 Add this device is), for a device the computer doesn't trust yet. */
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
  let key: OwnerDeviceKey | undefined;
  let keyError = '';
  let signing = false;
  let closed = false;
  let pending: Pending | undefined;
  let figureKey = '';
  let logKey = '';

  const draft = () => store.drafts.here;
  const cubby = () => {
    const id = draft()?.cubbyId;
    return id ? store.cubbies.cubbies.find((c) => c.id === id && c.mine) : undefined;
  };
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

    // Who can send: this account, on a device the draft's computer trusts, with the computer awake.
    const cb = cubby();
    const it = cb?.interior;
    const computer = clip(it?.computerName ?? '', 32) || 'your computer';
    const lead = clip(it?.leadName ?? d.leadName ?? '', 24) || 'your lead';
    const asleep = !d.online || cb?.lamp === 'asleep';
    const trusted = deviceTrusted(cb, key);
    const sameAccount = store.me.account?.name === account;
    let why = '';
    let needsDevice = false;
    if (!sameAccount) why = 'Account changed. Close and reopen this card.';
    else if (!d.cubbyId || !cb) why = 'Set up your lead at the studio table to leave feedback.';
    else if (keyError) why = keyError;
    else if (!key) why = 'Preparing this device’s owner key…';
    else if (!it?.ownerDevices || !it.computerId) why = `Waiting for ${computer} to say which devices it trusts.`;
    else if (!trusted) {
      why = `This device can't leave feedback yet. Add it in ${lead}'s chat with 📱 Add this device, and approve it from a device you already use.`;
      needsDevice = true;
    } else if (asleep) why = `💤 ${computer} is asleep. Feedback can be sent once it wakes.`;
    else if (pending?.failed && pending.board === card.board && pending.cardId === card.id) why = `${computer} didn't confirm that note. Check it's awake and try again.`;
    status.textContent = why;
    status.style.display = why ? '' : 'none';
    status.classList.toggle('asleep', asleep && !needsDevice);
    chatBtn.style.display = needsDevice && deps.openChat ? '' : 'none';
    form.style.display = sameAccount && d.cubbyId && cb && trusted ? '' : 'none';
    const sendingHere = !!pending && !pending.failed;
    text.disabled = asleep || signing;
    send.disabled = asleep || signing || sendingHere || !trusted;
    send.textContent = signing || sendingHere ? 'Sending…' : 'Send feedback';
    text.placeholder = asleep ? '' : `Feedback on ${clip(card.title, 40)}…`;
  }

  chatBtn.addEventListener('click', () => {
    const id = draft()?.cubbyId;
    if (id) deps.openChat?.(id);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = draft();
    const card = findCard(d?.boards, at.board, at.id);
    const cb = cubby();
    const computerId = cb?.interior?.computerId;
    const body = text.value.replace(/\r\n?/g, '\n').trim().slice(0, DRAFT_LIMITS.feedbackText);
    if (!body || !d || !card || !cb || !computerId || !d.online || cb.lamp === 'asleep' || signing || (pending && !pending.failed) ||
      !key || !deviceTrusted(cb, key) || store.me.account?.name !== account) return;
    signing = true;
    paint();
    try {
      const signed = { cardId: card.id, text: body, requestId: crypto.randomUUID(), at: Date.now() };
      const ownerSig = await signOwnerFeedback(key, { ...signed, cubbyId: cb.id, floorId: d.id, computerId });
      const now = draft();
      if (closed || now?.id !== d.id || store.me.account?.name !== account || cubby()?.interior?.computerId !== computerId || !deviceTrusted(cubby(), key)) return;
      if (pending) clearTimeout(pending.timer);
      const p: Pending = {
        board: card.board, cardId: card.id, requestId: signed.requestId, text: body, before: new Set(card.feedback.map((f) => f.id)), failed: false,
        timer: setTimeout(() => {
          if (pending !== p) return;
          p.failed = true;
          if (!text.value) text.value = p.text;
          paint();
        }, CONFIRM_MS),
      };
      pending = p;
      deps.send({ t: 'drafts.feedback', floorId: d.id, ...signed, ownerSig });
      text.value = '';
    } catch {
      keyError = 'Could not sign this note. Reopen the card and check browser storage.';
    } finally {
      signing = false;
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
  void ownerDeviceKey(account).then((k) => { key = k; paint(); }).catch((error: Error) => { keyError = error.message; paint(); });
  if (deps.focus) setTimeout(() => { if (!text.disabled) text.focus(); }, 30);
  return modal;
}
