import { DRAFT_LIMITS, type DraftBoards, type DraftFeedback } from '../../shared/protocol/drafts.js';

export const FEEDBACK_FULL = "The board's feedback is full. Moving or resolving notes on your computer frees room.";
/** JSON escaping matters: quotes, backslashes and newlines consume extra wire bytes. */
export function feedbackBytes(note: Pick<DraftFeedback, 'text'>): number {
  return Buffer.byteLength(JSON.stringify(note.text)) - 2 + DRAFT_LIMITS.feedbackNoteOverhead;
}
export function boardFeedbackBytes(boards: DraftBoards): number {
  return [...boards.ideas, ...boards.screens].reduce((total, card) =>
    total + card.feedback.reduce((sum, note) => sum + feedbackBytes(note), 0), 0);
}
