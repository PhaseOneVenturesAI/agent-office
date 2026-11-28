// The design board's words and cards (cubbies step 5), for the 3D office's wall and the phone's Draft
// board alike: which cards a board has, what each card's chip says, and how many feedback notes it
// has. No three.js and nothing of the 3D office, so the 2D view can load it (tests/client-structure.test.ts).

import type { DraftBoards, DraftFeedback, DraftIdea, DraftImage, DraftScreen } from '../../../shared/protocol/drafts';

/** The two boards that carry cards. */
export type CardBoard = 'ideas' | 'screens';

/** One card as the board and its window show it: an idea or a screen, the same shape. */
export interface BoardCard {
  version?: number;
  board: CardBoard;
  id: string;
  title: string;
  note?: string;
  image?: DraftImage;
  /** Screens only. */
  status?: DraftScreen['status'];
  feedback: DraftFeedback[];
}

export const CARD_BOARD_TITLE: Record<CardBoard, string> = { ideas: '💡 Ideas', screens: '🖼️ Screens' };
export const CARD_BOARD_EMPTY: Record<CardBoard, string> = {
  ideas: 'Ideas your lead works out with you appear here',
  screens: 'Screens your helpers draw hang here for your ✓',
};

/** A screen's status chip. */
export const SCREEN_CHIP: Record<DraftScreen['status'], { text: string; bg: string; color: string }> = {
  sketch: { text: '✏️ sketch', bg: '#e9ecef', color: '#2b2d42' },
  review: { text: '👀 review', bg: '#ffd166', color: '#2b2d42' },
  approved: { text: '✓ approved', bg: '#06d6a0', color: '#2b2d42' },
};

const fromIdea = (i: DraftIdea): BoardCard => ({ board: 'ideas', id: i.id, title: i.title, ...(i.note ? { note: i.note } : {}), ...(i.image ? { image: i.image } : {}), feedback: i.feedback });
const fromScreen = (s: DraftScreen): BoardCard => ({ board: 'screens', version: s.version, id: s.id, title: s.title, status: s.status, ...(s.note ? { note: s.note } : {}), ...(s.image ? { image: s.image } : {}), feedback: s.feedback });

/** A board's cards, in the order the computer sent them. */
export function boardCards(b: DraftBoards, board: CardBoard): BoardCard[] {
  return board === 'ideas' ? b.ideas.map(fromIdea) : b.screens.map(fromScreen);
}

/** One card by its board and id, if it's still there. */
export function findCard(b: DraftBoards | undefined, board: CardBoard, id: string): BoardCard | undefined {
  return b ? boardCards(b, board).find((c) => c.id === id) : undefined;
}

/** "💬 3" on a card with feedback, nothing on one without. */
export function feedbackBadge(c: Pick<BoardCard, 'feedback'>): string {
  return c.feedback.length ? `💬 ${c.feedback.length}` : '';
}

/** When a note was left: the time today, else the day and time. */
export function feedbackTime(at: number, now = Date.now()): string {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** What the card window's E hint calls it. */
export function openLabel(c: Pick<BoardCard, 'title'>, max = 28): string {
  const t = c.title.trim();
  return `Open ${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}`;
}

/**
 * Whether `card` now has the note that was sent: the computer reports it with the request's id, or
 * (should it give its own) as a note with the same words that wasn't there when it was sent.
 */
export function feedbackLanded(card: Pick<BoardCard, 'feedback'>, sent: { requestId: string; text: string; before: ReadonlySet<string> }): boolean {
  return card.feedback.some((f) => f.id === sent.requestId || (!sent.before.has(f.id) && f.text === sent.text));
}
