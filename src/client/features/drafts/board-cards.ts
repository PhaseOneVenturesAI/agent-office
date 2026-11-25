// E on a design board card (cubbies step 5): aiming at a card on the Ideas or Screens board says
// "[E] Open <title>", and E opens it big in the card window (shared/drafts/card.ts, which the phone
// uses too), with its feedback and a box to leave some. The wall redraws as each image comes in.

import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { CARD_BOARD_TITLE, feedbackBadge, findCard, openLabel } from '../../shared/drafts/board';
import { openDraftCard } from '../../shared/drafts/card';
import { onDraftImage } from '../../shared/drafts/images';
import type { DraftBoardsView } from './boards';

declare module '../../world/types' {
  interface InteractKinds {
    draftcard: true;
  }
}

export interface DraftCardsDeps {
  boards: DraftBoardsView;
  /** Whether the draft is up (you're on it). */
  shown(): boolean;
  /** Opens the draft's lead chat (where 📱 Add this device is). */
  talk(cubbyId: string): void;
}

export function wireDraftCards(ctx: Ctx, deps: DraftCardsDeps) {
  const { boards } = deps;
  onDraftImage(() => {
    boards.refresh();
    ctx.hint.invalidate();
  });
  ctx.usables.add({ usable: () => (deps.shown() ? boards.interactables() : []) });

  ctx.interactions.define('draftcard', {
    reach: 8,
    hint: (it) => {
      const at = boards.cardAt(it);
      const card = at && findCard(store.drafts.here?.boards, at.board, at.cardId);
      if (!at || !card) return { k: 'draftcard-none', parts: [] };
      const fb = feedbackBadge(card);
      const sub = [at.more ? `+${at.more} more` : '', fb].filter(Boolean).join(' · ');
      return { k: `draftcard-${at.board}-${card.id}-${card.title}-${sub}`, parts: [hintTitle(CARD_BOARD_TITLE[at.board]), aside(sub), key('E', openLabel(card))] };
    },
    use: onE((it) => {
      const at = boards.cardAt(it);
      if (!at || !store.drafts.here) return;
      openDraftCard({ send: (m) => ctx.net.send(m), openChat: deps.talk, focus: true }, at.board, at.cardId);
    }),
  });
}
