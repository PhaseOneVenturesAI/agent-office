import type { ClientMsg } from '../../../shared/protocol';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { draftImage, imageCanvas, onDraftImage } from '../drafts/images';
import { findCard, boardCards, type CardBoard } from '../drafts/board';
import './studio.css';
export function openStudioCard(send: (msg: ClientMsg) => void, board: CardBoard, id: string) {
  const project = store.drafts.here?.name, account = store.me.account?.name;
  const title = h('h2'), versions = h('div.studio-versions'), log = h('div'), status = h('p', { role: 'status' });
  const text = h('textarea', { rows: 3, maxlength: 1000, 'aria-label': 'Change this', placeholder: 'Change this…' });
  const actions = h('div.studio-actions'); let selected = id;
  const feedback = (value: string) => {
    if (!project || !value.trim() || store.me.account?.name !== account || !store.drafts.here?.online) return;
    send({ t: 'studio.feedback', project, cardId: selected, text: value.trim() });
    status.textContent = 'Sent to your Studio lead. Decisions update when the lead writes the board.'; text.value = '';
  };
  const paint = () => {
    const draft = store.drafts.here, card = findCard(draft?.boards, board, selected);
    if (!draft?.studio || draft.name !== project || !card || store.me.account?.name !== account) { title.textContent = 'Card unavailable'; versions.replaceChildren(); actions.replaceChildren(); return; }
    title.textContent = card.title;
    const cards = board === 'screens' ? boardCards(draft.boards, board).filter(c => c.title === card.title).sort((a,b) => (a.version ?? 1) - (b.version ?? 1)) : [card];
    versions.replaceChildren(...cards.map(c => {
      const image = c.image && draftImage(draft.id, c.image);
      return h('section', { class: c.id === selected ? 'selected' : '' }, board === 'screens' ? h('button.btn', { type: 'button', onclick: () => { selected = c.id; paint(); }, 'aria-pressed': c.id === selected }, `v${c.version ?? 1} · ${c.status}`) : null,
        image ? imageCanvas(image) : h('p', {}, c.image ? 'Loading screen…' : c.title), h('p', {}, c.note ?? ''));
    }));
    log.replaceChildren(...card.feedback.map(f => h('p', {}, f.text)));
    actions.replaceChildren(...['👍', '👎', ...(board === 'screens' ? ['Approve'] : [])].map(label => h('button.btn', { type: 'button', disabled: !draft.online, onclick: () => feedback(label) }, label)));
    text.disabled = !draft.online;
  };
  const form = h('form', {}, text, h('button.btn', { type: 'submit' }, 'Change this…'));
  form.onsubmit = e => { e.preventDefault(); feedback(text.value); };
  const el = h('div.modal.studio-review', { role: 'dialog', 'aria-label': 'Studio review' }, h('header', {}, title), h('div.body', {}, versions, actions, form, status, log));
  const offs = [store.on('drafts', paint), store.on('me', paint), onDraftImage(paint)]; paint();
  return openModal(el, { doing: 'Reviewing Studio work', onClose: () => offs.forEach(off => off()) });
}
