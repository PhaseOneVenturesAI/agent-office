import './litesuggest.css';
// Offering a choice of views on phones, or 2D where frames come slowly (see framerate.ts).

import { h } from './dom';

/** Said to stay in 3D: this browser isn't offered the 2D view again (it's in the ☰ menu). */
const DECLINED_KEY = 'agent-office.lite-declined';

/** A touch screen and no mouse: a phone or a tablet that needs on-screen controls. */
export function touchOnly(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

function declined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

let offered = false;

/** Offers the 2D view, at most once a page, unless this browser said to stay in 3D before. */
export function offerLite(why: 'touch' | 'slow') {
  if (offered || declined()) return;
  offered = true;
  const say =
    why === 'touch'
      ? '📱 Walk around in 3D with on-screen controls, or open the 2D view for workers, terminals and boards.'
      : '🐢 The 3D office is running slowly on this computer. The 2D view has the workers, their terminals and the boards, without the 3D.';
  const stay = h('button.btn', { type: 'button' }, 'Stay in 3D');
  const close = h('button.btn.close.corner', { type: 'button', 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.lite-offer.panel',
    { role: 'dialog', 'aria-label': 'Try the 2D view' },
    close,
    h('p', {}, say),
    h('div.lite-offer-btns', {}, h('a.btn.primary', { href: '/lite' }, 'Open the 2D view'), stay),
  );
  const dismiss = () => { el.remove(); document.removeEventListener('keydown', escape); };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', escape);
  stay.addEventListener('click', () => {
    try {
      localStorage.setItem(DECLINED_KEY, '1');
    } catch {
      // storage blocked: it's only this page then
    }
    dismiss();
  });
  document.body.append(el);
}
