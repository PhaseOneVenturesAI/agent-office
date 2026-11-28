import './ui.css';
// The window for your status: one of the usual ones in a click, or an emoji and your own words.
import { STATUS_EMOJIS, STATUS_PRESETS, STATUS_TEXT_MAX, sanitizeStatus, statusLabel, type PeerStatus } from '../../../shared/peer-status';
import { h, openModal } from '../../ui/dom';

/** Opens the status window with `current` filled in; `set` hears the new one (undefined: taken down). */
export function openStatus(current: PeerStatus | undefined, set: (s: PeerStatus | undefined) => void) {
  let emoji = current?.emoji ?? STATUS_PRESETS[0].emoji;
  const done = (s: PeerStatus | undefined) => {
    set(s);
    modal.close();
  };

  const presets = h(
    'div.status-presets',
    {},
    ...STATUS_PRESETS.map((p) => h('button.btn', { type: 'button', onclick: () => done(p) }, statusLabel(p))),
  );

  const pick = h('button.btn.status-pick', { type: 'button', 'aria-label': 'Emoji', title: 'No emoji' });
  const grid = h('div.status-emojis', { role: 'listbox', 'aria-label': 'Emoji' });
  const showEmoji = () => {
    pick.textContent = emoji || '∅';
    pick.title = emoji ? 'Click for no emoji' : 'No emoji';
    for (const b of grid.children) b.classList.toggle('on', (b as HTMLElement).dataset.emoji === emoji);
  };
  pick.addEventListener('click', () => ((emoji = ''), showEmoji()));
  for (const e of STATUS_EMOJIS) {
    grid.append(h('button.btn', { type: 'button', 'data-emoji': e, 'aria-label': e, onclick: () => ((emoji = e), showEmoji(), input.focus()) }, e));
  }

  const input = h('input', { type: 'text', maxlength: STATUS_TEXT_MAX * 2, placeholder: 'What’s up? (BRB, at the dentist…)', 'aria-label': 'Status', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  input.value = current?.text ?? '';
  const save = () => done(sanitizeStatus({ emoji, text: input.value }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  const clear = h('button.btn', { type: 'button', onclick: () => done(undefined) }, 'Clear status');
  const footer = h(
    'footer',
    {},
    h('span.grow', {}, 'Everyone sees it over your head, and next to your name under 👥 People.'),
    current ? clear : null,
    h('button.btn.primary', { type: 'button', onclick: save }, 'Set status'),
  );
  const el = h(
    'div.modal.status-window',
    { role: 'dialog', 'aria-label': 'Your status' },
    h('header', {}, h('h2', {}, '💬 Your status')),
    h('div.body', {}, h('label', {}, 'Quick pick'), presets, h('label', {}, 'Or your own'), h('div.status-row', {}, pick, input), grid),
    footer,
  );
  showEmoji();
  const modal = openModal(el);
  input.focus();
}
