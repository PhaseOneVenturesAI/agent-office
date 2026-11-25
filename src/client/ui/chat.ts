// The chat in the corner: the latest lines. A line folds away once it's a while old, but hovering
// the chat, typing in it or selecting text in it keeps the whole scrollback there to read and copy.

import { store } from '../state';
import type { ChatLine } from '../../shared/protocol';
import { $, h } from './dom';
import { linkify } from './links';

/** How long a chat line stays up before it folds away. Hovering the chat, or typing in it, keeps them all. */
const CHAT_LINGER = 12_000;
/** The fade-out the fold waits for (the .6s of `chat-out` in styles/hud.css). */
const CHAT_FADE = 600;
/** When this page first showed each line. */
const chatSeen = new WeakMap<ChatLine, number>();
/** The lines in the log now, each with when it was first shown, as the last renderChat drew them. */
let drawn: { el: HTMLElement; seen: number }[] = [];
let foldTimer: ReturnType<typeof setTimeout> | undefined;
/** A line came in (or folded) while someone was selecting text in the log: redraw once they've let go. */
let behind = false;
let watching = false;

/** The message with its URLs as links that open in a tab of their own; all else stays plain text. */
function message(text: string): (string | HTMLAnchorElement)[] {
  return linkify(text).map((p) => (typeof p === 'string' ? p : h('a', { href: p.href, target: '_blank', rel: 'noopener noreferrer', title: p.href }, p.href)));
}

function line(c: ChatLine, seen: number, now: number): HTMLElement {
  const body = c.from
    ? [
        h('b', { style: `color:${c.color}`, title: c.account ? `${c.name}, signed in with their own account` : undefined }, c.name),
        c.account ? h('span.acct', {}, ' ✓') : null,
        ': ',
        ...message(c.text),
      ]
    : message(c.text); // No sender: a note from the office itself.
  // Older lines start their fade in the past, so a redraw doesn't bring them back.
  return h('li', { class: c.from ? undefined : 'sys', title: new Date(c.at).toLocaleString(), style: `animation-delay:${Math.round(CHAT_LINGER - (now - seen))}ms` }, ...body);
}

/** Folds each line away as its fade runs out, and books the next fold. */
function scheduleFolds(now: number) {
  clearTimeout(foldTimer);
  foldTimer = undefined;
  let next = Infinity;
  for (const { el, seen } of drawn) {
    const left = CHAT_LINGER + CHAT_FADE - (now - seen);
    if (left <= 0) el.classList.add('folded');
    else next = Math.min(next, left);
  }
  if (next < Infinity) foldTimer = setTimeout(() => scheduleFolds(performance.now()), next + 50);
}

/** Redraws once a selection in the log is let go, if lines came in or folded while it was held. */
function watchSelection() {
  if (watching) return;
  watching = true;
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (behind && (!sel || sel.isCollapsed)) renderChat();
  });
}

export function renderChat() {
  const log = $('chat-log');
  // Don't pull lines out from under someone selecting text to copy: catch up once they've let go.
  const sel = document.getSelection();
  if (sel && !sel.isCollapsed && sel.anchorNode && log.contains(sel.anchorNode)) {
    behind = true;
    watchSelection();
    return;
  }
  behind = false;
  const now = performance.now();
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 12;
  drawn = store.chat.slice(-60).map((c) => {
    const seen = chatSeen.get(c) ?? now;
    chatSeen.set(c, seen);
    return { el: line(c, seen, now), seen };
  });
  log.replaceChildren(...drawn.map((d) => d.el));
  // Someone who scrolled up to read stays where they are; otherwise the newest line is in view.
  if (atBottom) log.scrollTop = log.scrollHeight;
  scheduleFolds(now);
}
