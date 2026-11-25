import './ui.css';
import type { Launched } from '../../../shared/protocol/drafts';
import { h, openModal } from '../../ui/dom';
import { designBook } from './kickoff-model';

// The Design book on a kicked-off floor's bookshelf: the brand it was kicked off with (name, tagline
// and colors) and the screens approved before kickoff, the reference every PR is checked against.
// Text the page was sent, shown as text.

export function openDesignBook(l: Launched) {
  const b = designBook(l);
  const swatches = b.colors.map((c) => h('li.db-swatch', {}, h('span.db-chip', { style: `background:${c}`, 'aria-hidden': 'true' }), h('code', {}, c.toUpperCase())));
  const screens = b.screens.length ? h('ol.db-screens', {}, ...b.screens.map((s) => h('li', {}, h('span.db-check', { 'aria-hidden': 'true' }, '✓'), h('span', {}, s)))) : h('p.db-empty', {}, b.empty);
  const panel = h(
    'div.modal.design-book',
    { role: 'dialog', 'aria-label': b.title },
    h('header', {}, h('h2', {}, b.title)),
    h(
      'div.body',
      {},
      h('section.db-brand', {}, h('h3', {}, b.brand), b.tagline ? h('p.db-tagline', {}, b.tagline) : null, swatches.length ? h('ul.db-swatches', {}, ...swatches) : null),
      h('h4', {}, `Approved screens${b.screens.length ? ` · ${b.screens.length}` : ''}`),
      screens,
      l.repo ? h('p.db-repo', {}, `In ${l.repo}`) : null,
    ),
  );
  openModal(panel, { doing: '📘 reading the Design book', reading: true });
}
