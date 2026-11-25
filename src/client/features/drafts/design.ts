// What a kicked-off floor keeps for everyone on it (store.drafts.launched): the Design book on the
// bookshelf and the brand poster by the elevator (launched.ts builds them), put up while the floor you're
// on has one and away everywhere else. E at the book opens it (ui-design.ts).

import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { clip } from './model';
import { openDesignBook } from './ui-design';

declare module '../../world/types' {
  interface InteractKinds {
    designbook: true;
  }
}

export function wireDesignBook(ctx: Ctx) {
  const view = ctx.office.launched;
  const sync = () => view.set(store.drafts.launched);
  store.on('drafts', sync);
  sync();

  ctx.interactions.define('designbook', {
    reach: 2.6,
    hint: () => {
      const l = store.drafts.launched;
      const n = l?.screens.length ?? 0;
      return { k: `designbook-${l?.name}-${n}`, parts: [hintTitle('📘 Design'), aside(l ? `${clip(l.brand.name || l.name, 24)} · ${n} approved screen${n === 1 ? '' : 's'}` : ''), key('E', 'Open')] };
    },
    use: onE(() => {
      const l = store.drafts.launched;
      if (l) openDesignBook(l);
    }),
  });
}
