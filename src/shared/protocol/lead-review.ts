import { validVerdict } from '../pitch/clean.js';
import type { PitchVerdictMessage } from './pitch.js';
/** Structured reviews ride lead.send; the link saves them before notifying the lead. */
export type LeadReview = { kind: 'draft'; cardId: string; text: string; requestId: string; at: number }
  | ({ kind: 'pitch' } & PitchVerdictMessage);
export function cleanReview(raw: any): LeadReview | undefined {
  if (!raw || typeof raw.requestId !== 'string' || !/^[\w-]{1,128}$/.test(raw.requestId) || !Number.isSafeInteger(raw.at)) return;
  if (raw.kind === 'draft' && typeof raw.cardId === 'string' && /^[\w-]{1,64}$/.test(raw.cardId) && typeof raw.text === 'string' && raw.text.trim() && raw.text.length <= 1000)
    return { kind: 'draft', cardId: raw.cardId, text: raw.text.trim(), requestId: raw.requestId, at: raw.at };
  if (raw.kind === 'pitch' && validVerdict(raw)) return { kind: 'pitch', pieceId: raw.pieceId, version: raw.version, verdict: raw.verdict,
    ...(raw.note !== undefined ? { note: raw.note } : {}), requestId: raw.requestId, at: raw.at };
}
