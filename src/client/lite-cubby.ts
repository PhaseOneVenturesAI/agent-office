// My cubby on the 2D view (/lite, cubbies step 4): with a cubby of yours on the floor you're on, a
// button opens the same lead chat as the 3D office's (shared/cubby/chat.ts), signed with this browser's
// signed-in account, beside what needs you and how each helper is doing. Watching someone's cubby (they let you
// in from the 3D office), the same button opens it read-only. No three.js and nothing of the 3D office.

import type { CubbyInfo } from '../shared/protocol/cubbies';
import type { Net } from './net';
import { store } from './state';
import { $ } from './ui/dom';
import { openLeadChat, type CubbyWindows } from './shared/cubby/chat';
import { clip } from './shared/cubby/text';

/** The cubby My cubby opens: yours on this floor, else one you're watching here. */
export function liteCubby(cubbies: readonly CubbyInfo[]): CubbyInfo | undefined {
  return cubbies.find((c) => c.mine) ?? cubbies.find((c) => c.watching && c.interior);
}

/** What its button says. */
export function liteCubbyLabel(c: CubbyInfo): string {
  // The nav button is narrow on a phone: the first name only.
  const first = clip(c.ownerName.trim().split(/\s+/)[0] ?? '', 10);
  return c.mine ? '🚪 My cubby' : first ? `👀 ${first}'s cubby` : '👀 Watching';
}

export function installLiteCubby(net: Net) {
  const button = $('btn-cubby') as HTMLButtonElement;
  const windows: CubbyWindows = {
    cubby: (id) => store.cubbies.cubbies.find((c) => c.id === id),
    onChange: (fn) => store.on('cubbies', fn),
    sendOut: (id, accountId) => net.send({ t: 'cubbies.admit', id, accountId, allow: false }),
  };
  const render = () => {
    const c = store.cubbies.enabled ? liteCubby(store.cubbies.cubbies) : undefined;
    button.classList.toggle('hidden', !c);
    if (!c) return;
    const label = button.querySelector('.lbl')!;
    label.textContent = liteCubbyLabel(c);
    button.title = c.mine ? 'Your cubby: your lead, what needs you and your helpers' : `Watching ${c.ownerName}'s cubby (read-only)`;
    // What needs you, counted on the button the way the boards count theirs.
    const needs = c.mine ? (c.interior?.needsYou.length ?? 0) : 0;
    button.querySelector('.n')!.textContent = needs ? String(needs) : '';
    button.dataset.cubby = c.id;
  };
  button.addEventListener('click', () => {
    const id = button.dataset.cubby;
    if (id) openLeadChat(windows, id);
  });
  store.on('cubbies', render);
  store.on('floor', render);
  render();
  /** The lead chat for one of your cubbies (the Draft board's card points there to add this device). */
  return { openChat: (id: string) => void openLeadChat(windows, id) };
}
