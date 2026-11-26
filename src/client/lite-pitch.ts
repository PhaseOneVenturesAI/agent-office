import { store } from './state';
import type { Net } from './net';
import { h } from './ui/dom';
import { pitchImageUrl } from '../shared/protocol/pitch';
import { openPitchPiece, verdictLabel } from './shared/pitch/review';
/** Owner-only list in the existing main content; uses the same review window and signatures. */
export function installLitePitch(net: Net) {
  const section = h('section.pitch-list', { 'aria-label': 'Pitch' });
  document.querySelector('.lite-main')!.prepend(section);
  function paint() {
    const v = store.pitch; section.hidden = !v;
    if (!v) { section.replaceChildren(); return; }
    section.replaceChildren(h('h2', {}, `${v.pitch.department} pitch · ${v.pitch.status === 'ready' ? 'ready to pitch' : 'building'}`),
      h('p', {}, `${v.pitch.lead} · ${v.pitch.version}`), h('ul', {}, ...v.pitch.pieces.map(p => {
        const img = p.image ?? p.images[0];
        return h('li', {}, img ? h('img', { src: pitchImageUrl(v.cubbyId, img.hash), alt: p.title }) : null,
          h('h3', {}, p.title), h('p', {}, p.notes.join('\n')), h('p.pitch-stamp', {}, p.stamp ? `${verdictLabel(p.stamp.verdict)}${p.stamp.note ? ` — ${p.stamp.note}` : ''}` : 'Awaiting your verdict'),
          h('button.btn', { onclick: () => openPitchPiece({ send: m => net.send(m) }, p.id) }, 'Open / large view'),
          h('div.pitch-actions', {}, ...([['approve', 'Approve'], ['change', 'Change…'], ['drop', 'Drop']] as const).map(([verdict, label]) =>
            h('button.btn', { onclick: () => openPitchPiece({ send: m => net.send(m) }, p.id, 0, verdict) }, label))));
      })));
  }
  store.on('pitch', paint); store.on('floor', paint); paint();
}
