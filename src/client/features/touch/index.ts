import { Vector2 } from 'three';
import type { Ctx } from '../../core/context';
import { isTyping } from '../../player';
import { modalOpen } from '../../ui/dom';
import { lookDrag, stickMovement, touchFirst } from './math';
import { createTouchUI, hintVerb } from './ui';

type Gesture = { kind: 'stick' | 'look' | 'E' | 'Q'; x: number; y: number; moved: number; surface: HTMLElement };

/** Touch owns only its surfaces. Movement, clicks and E/Q still use the office's ordinary paths. */
const touchOnly = () => touchFirst(matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints ?? 0);

export function installTouch(ctx: Ctx) {
  if (!touchOnly()) return;
  const { player } = ctx;
  const ui = createTouchUI();
  const pointers = new Map<number, Gesture>();
  let movement = { x: 0, z: 0 };
  let active = false;
  const key = (code: 'E' | 'Q', down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: code.toLowerCase(), code: `Key${code}`, bubbles: true, cancelable: true }));

  function reset() {
    const held = [...pointers];
    pointers.clear();
    movement = { x: 0, z: 0 };
    Object.assign(player.walkInput, movement);
    ui.knob.style.transform = '';
    for (const [id, g] of held) {
      if (g.kind === 'E' || g.kind === 'Q') key(g.kind, false);
      if (g.surface.hasPointerCapture(id)) g.surface.releasePointerCapture(id);
    }
  }
  function blocked() {
    const vv = window.visualViewport;
    const keyboard = !!vv && vv.scale === 1 && innerHeight - vv.height > 120;
    return !touchOnly() || !player.enabled || !player.mouseLook || document.hidden || modalOpen() || isTyping() || keyboard || !!ctx.trip() ||
      !!document.querySelector('.lite-offer, #loading:not(.hidden)') ||
      [...document.querySelectorAll<HTMLElement>('.side section')].some(el => el.getClientRects().length > 0);
  }
  function sync() {
    const available = touchOnly();
    player.onScreenControls = available;
    document.body.classList.toggle('touch-enabled', available);
    const chat = document.getElementById('chat-input') as HTMLInputElement | null;
    if (chat) chat.placeholder = available ? 'Tap to chat' : 'Press T to chat';
    const typing = available && isTyping();
    if (document.body.classList.contains('touch-typing') !== typing) {
      document.body.classList.toggle('touch-typing', typing);
      ui.schedule();
    }
    const next = !blocked();
    if (active && !next) reset();
    if (active !== next) ui.schedule();
    active = next;
    ui.root.hidden = !active;
  }
  function begin(e: PointerEvent, kind: Gesture['kind'], surface: HTMLElement) {
    if (e.pointerType !== 'touch' || blocked() || [...pointers.values()].some(g => g.kind === kind)) return;
    e.preventDefault();
    e.stopPropagation();
    pointers.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, moved: 0, surface });
    surface.setPointerCapture(e.pointerId);
    if (kind === 'stick') move(e);
    else if (kind === 'E' || kind === 'Q') key(kind, true);
    sync();
  }
  function move(e: PointerEvent) {
    const g = pointers.get(e.pointerId);
    if (!g) return;
    if (blocked()) return reset();
    e.preventDefault();
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.x = e.clientX; g.y = e.clientY;
    g.moved += Math.hypot(dx, dy);
    if (g.kind === 'stick') {
      const rect = ui.stick.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
      movement = stickMovement(x, y, ui.radius());
      const scale = Math.min(1, ui.radius() / (Math.hypot(x, y) || 1));
      ui.knob.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    } else if (g.kind === 'look') {
      const third = player.view === 'third';
      const look = lookDrag(player.camYaw, third ? player.camPitch : player.lookPitch, dx, dy, ui.short(), third);
      player.camYaw = look.yaw;
      if (third) player.camPitch = look.pitch;
      else player.lookPitch = look.pitch;
    }
  }
  function end(e: PointerEvent) {
    const g = pointers.get(e.pointerId);
    if (!g) return;
    pointers.delete(e.pointerId);
    if (g.surface.hasPointerCapture(e.pointerId)) g.surface.releasePointerCapture(e.pointerId);
    if (g.kind === 'stick') {
      movement = { x: 0, z: 0 };
      Object.assign(player.walkInput, movement);
      ui.knob.style.transform = '';
    } else if (g.kind === 'E' || g.kind === 'Q') key(g.kind, false);
    else if (e.type === 'pointerup' && g.moved <= 6 && !blocked()) {
      const rect = ctx.canvas.getBoundingClientRect();
      const ndc = player.view === 'first' ? new Vector2() : new Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2);
      player.onClick?.(ndc);
    }
  }
  const surfaces: [HTMLElement, Gesture['kind']][] = [[ui.stick, 'stick'], [ui.look, 'look'], [ui.action, 'E'], [ui.secondary, 'Q']];
  for (const [surface, kind] of surfaces) {
    surface.addEventListener('pointerdown', e => begin(e, kind, surface));
    surface.addEventListener('pointermove', move);
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) surface.addEventListener(event, end);
  }
  // Keyboard/assistive activation of a button has no pointer sequence.
  for (const [button, code] of [[ui.action, 'E'], [ui.secondary, 'Q']] as const) button.addEventListener('click', e => {
    if (e.detail !== 0 || blocked()) return;
    key(code, true); key(code, false);
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', () => queueMicrotask(sync));
  window.addEventListener('resize', reset);
  window.visualViewport?.addEventListener('resize', () => { reset(); sync(); });
  for (const query of ['(pointer: coarse)']) matchMedia(query).addEventListener('change', sync);
  ctx.windowOpened.add(() => { reset(); sync(); });
  ctx.ticks.add('pre', sync);
  ctx.ticks.add('steer', () => { if (active) Object.assign(player.walkInput, movement); });
  ctx.ticks.add('hud', () => {
    if (!active) return;
    const verb = hintVerb('E') ?? 'Use';
    if (ui.action.textContent !== verb) {
      ui.action.textContent = verb;
      ui.action.setAttribute('aria-label', `E: ${verb}`);
    }
    const second = hintVerb('Q');
    if (ui.secondary.hidden !== !second) { ui.secondary.hidden = !second; ui.schedule(); }
    if (second && ui.secondary.textContent !== second) {
      ui.secondary.textContent = second;
      ui.secondary.setAttribute('aria-label', `Q: ${second}`);
    }
  });
  sync();
}
