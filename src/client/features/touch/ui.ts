import { h } from '../../ui/dom';
import { lookRegion, touchLayout } from './math';
import './ui.css';

export function createTouchUI() {
  const knob = h('span', {}, 'Walk');
  const stick = h('div.touch-stick.touch-surface', { role: 'group', 'aria-label': 'Drag to walk' }, knob);
  const look = h('div.touch-look.touch-surface', { role: 'group', 'aria-label': 'Drag to look; tap to interact' });
  const action = h('button.touch-action.touch-surface', { type: 'button', 'aria-label': 'E: Use' }, 'Use');
  const secondary = h('button.touch-secondary.touch-surface', { type: 'button', hidden: true });
  const root = h('div.touch-controls', { 'aria-label': 'Touch controls' }, look, stick, action, secondary);
  document.body.append(root);
  const chat = document.getElementById('chat')!;
  const hint = document.getElementById('hint')!;
  const topbar = document.querySelector<HTMLElement>('.topbar')!;
  let short = 320;
  let radius = 30;
  let queued = false;
  const visible = (el: HTMLElement) => el.getClientRects().length > 0;

  function layout() {
    queued = false;
    const vv = window.visualViewport;
    const width = vv?.width ?? innerWidth, height = vv?.height ?? innerHeight;
    const x = vv?.offsetLeft ?? 0, y = vv?.offsetTop ?? 0;
    Object.assign(root.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    const css = getComputedStyle(root);
    const safe = { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight), top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) };
    const size = touchLayout(width, height, safe);
    short = size.short;
    radius = size.stick * 0.28;
    root.style.setProperty('--stick', `${size.stick}px`);
    root.style.setProperty('--action', `${size.action}px`);
    document.body.style.setProperty('--touch-row', `${size.row}px`);
    document.body.style.setProperty('--touch-chat', `${visible(chat) ? chat.offsetHeight : 0}px`);
    document.body.style.setProperty('--touch-keyboard', `${Math.max(0, innerHeight - height - y)}px`);
    const top = Math.max(safe.top + 12, topbar.getBoundingClientRect().bottom - y + 12);
    const obstacles = [document.getElementById('chat-input')!, document.getElementById('chat-log')!, hint]
      .filter(visible).map(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left - x, right: r.right - x, top: r.top - y, bottom: r.bottom - y };
      });
    const region = lookRegion(width, top, height - size.bottom - (secondary.hidden ? size.action : size.row) - 12, width - safe.right, obstacles);
    Object.assign(look.style, { left: `${region.left}px`, top: `${region.top}px`, width: `${region.width}px`, height: `${region.height}px` });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(layout);
  }
  const observer = new ResizeObserver(schedule);
  for (const el of [document.documentElement, chat, hint, topbar]) observer.observe(el);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  // Class changes can show/hide a HUD element without changing its border box.
  new MutationObserver(schedule).observe(document.getElementById('hud')!, { subtree: true, attributes: true, attributeFilter: ['class'] });
  for (const surface of [stick, look, action, secondary]) {
    surface.addEventListener('contextmenu', e => e.preventDefault());
    surface.addEventListener('selectstart', e => e.preventDefault());
  }
  layout();
  return { root, stick, knob, look, action, secondary, schedule, short: () => short, radius: () => radius };
}

/** Read the existing hint, including activity hints and carried cards, rather than inventing verbs. */
export function hintVerb(code: string): string | null {
  const hint = document.getElementById('hint');
  if (!hint || hint.classList.contains('hidden')) return null;
  const key = [...hint.querySelectorAll<HTMLElement>('.key')].find(el => el.textContent?.trim() === code);
  if (!key?.parentElement) return null;
  return [...key.parentElement.childNodes].filter(n => n !== key).map(n => n.textContent).join('').trim() || null;
}
