import { randomBytes } from 'node:crypto';
import { lstatSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DRAFT_LIMITS, type DraftBoards, type DraftFeedback } from '../../../shared/protocol/drafts.js';
import { cleanDraftBoards } from '../../drafts/boards.js';
import { boardFeedbackBytes, feedbackBytes, FEEDBACK_FULL } from '../../drafts/feedback-budget.js';
import { jsonFile } from './io.js';

const fileLimit = 4 * 1024 * 1024;
function location(project: string) {
  const dir = path.join(project, '.agent-office'), s = lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink()) throw Error('Invalid board directory');
  return path.join(dir, 'feedback.json');
}
function read(project: string): Record<string, DraftFeedback[]> {
  try {
    const raw = jsonFile(location(project), fileLimit);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid feedback record');
    return raw;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
}
export function mergeFeedback(project: string, boards: DraftBoards): DraftBoards {
  const saved = read(project);
  for (const card of [...boards.ideas, ...boards.screens]) {
    const rows = Object.hasOwn(saved, card.id) && Array.isArray(saved[card.id]) ? saved[card.id] : [];
    card.feedback = [...new Map([...card.feedback, ...rows].map(f => [f.id, f])).values()];
  }
  return cleanDraftBoards(boards);
}
export function appendFeedback(project: string, boards: DraftBoards, cardId: string, note: DraftFeedback): void {
  const saved = read(project), file = location(project);
  const card = [...boards.ideas, ...boards.screens].find(c => c.id === cardId);
  if (!card) throw Error('Unknown board card');
  // Retain only current cards, and clean all rows before writing bounded private JSON.
  const merged = mergeFeedback(project, boards);
  if (boardFeedbackBytes(merged) + feedbackBytes(note) > DRAFT_LIMITS.feedbackBytes) throw Error(FEEDBACK_FULL);
  const rows = Object.create(null) as Record<string, DraftFeedback[]>;
  for (const c of [...merged.ideas, ...merged.screens]) rows[c.id] = c.feedback;
  if (rows[cardId].some(f => f.id === note.id) || Object.values(saved).some(v => Array.isArray(v) && v.some(f => f?.id === note.id))) throw Error('Feedback already saved');
  rows[cardId] = [...rows[cardId], note].slice(-DRAFT_LIMITS.feedbackPerCard);
  const tmp = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  } finally { try { unlinkSync(tmp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
}
