/** Emotes: G opens the wheel (hold it and point, or tap it and click); number keys play one straight away. */
import { EMOTES, EMOTE_BY_ID, EmoteBucket, type EmoteId } from '../../../shared/emotes';
import type { Ctx } from '../../core/context';
import { $, h, toast } from '../../ui/dom';
import { EmoteWheel } from './ui';

/** The quick-pick key for each emote: 1–9, then 0 and – (main row and numpad alike). */
const PICK_KEY = new Map<string, EmoteId>(EMOTES.flatMap((e, i) => {
  const keys = i < 9 ? [`Digit${i + 1}`, `Numpad${i + 1}`] : i === 9 ? ['Digit0', 'Numpad0'] : ['Minus', 'NumpadSubtract'];
  return keys.map((k) => [k, e.id] as const);
}));

export function installEmotes(ctx: Ctx) {
  /** The same limit the server keeps, so an emote you see yourself do is one everyone else sees too. */
  const emoteLimit = new EmoteBucket();
  let emoteWarnedAt = 0;
  /** The emote playing on your character now, if any (loops run until you move or pick another). */
  let current: EmoteId | null = null;
  /** Plays an emote on your character and your hands, and shows it to everyone else on the floor. */
  function emote(id: EmoteId) {
    const now = performance.now();
    if (!emoteLimit.take(now)) {
      if (now - emoteWarnedAt > 3000) {
        emoteWarnedAt = now;
        toast('Easy there, one emote at a time', 'warn');
      }
      return;
    }
    current = id;
    ctx.me.emote(id);
    ctx.hands.emote(id);
    if (ctx.player.view === 'first') popEmoji(id);
    ctx.net.send({ t: 'emote', emote: id });
  }
  // Your character cancels an emote when it moves (see Person.update); the first-person hands and the
  // popped emoji have no walk cycle to notice, so they're put away here.
  ctx.ticks.add('me', () => {
    if (current && ctx.me.emoteId === null) {
      current = null;
      ctx.hands.stopEmote();
      document.querySelector('.emote-pop')?.remove();
    }
  });

  const emoteWheel = new EmoteWheel(
    emote,
    (open) => {
      ctx.player.mouseLook = !open;
      // Closing it (an emote, ✕, Esc, G again) puts you straight back into mouse-look, no extra click.
      if (!open && ctx.player.enabled && ctx.player.canLock) ctx.player.lock();
    },
    // A quick tap leaves the wheel open to click: the page lets the mouse go itself, so close() takes it back.
    () => ctx.player.unlock(),
  );
  $('hud').append(emoteWheel.el);
  // A window opening puts the wheel away.
  ctx.windowOpened.add(() => emoteWheel.close());

  /** In first person you can't see the emoji over your head, so it pops up on the screen instead. One that stays (a dance) goes when the emote does (see the tick above). */
  function popEmoji(id: EmoteId) {
    const e = EMOTE_BY_ID.get(id)!;
    document.querySelector('.emote-pop')?.remove();
    const el = h('div.emote-pop', { class: e.loop ? 'stay' : undefined, style: `--secs:${e.seconds}s`, 'aria-hidden': 'true' }, e.emoji);
    if (!e.loop) el.addEventListener('animationend', () => el.remove());
    $('hud').append(el);
  }

  /** G opens the emote wheel (hold it and point, or tap it and click); a number key plays one straight away. */
  function emoteKey(e: KeyboardEvent): boolean {
    if (e.code === 'KeyG') {
      if (!e.repeat) emoteWheel.press();
      return true;
    }
    if (e.code === 'Escape' && emoteWheel.isOpen) {
      emoteWheel.close();
      return true;
    }
    const id = PICK_KEY.get(e.code);
    if (!id) return false;
    emoteWheel.close();
    emote(id);
    return true;
  }

  ctx.keys.add('emote', emoteKey);

  return { emote, emoteWheel };
}
