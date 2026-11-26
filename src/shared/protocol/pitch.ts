import type { DraftImage } from './drafts.js';

/** .agent-office/pitch.json: explicit local publication, at most one piece per kind.
 * Local image strings must be inside pitch/; only cleaned image metadata crosses the wire.
 * Saved verdicts are version-specific and come exclusively from pitch-feedback.json.
 * All ads share one verdict. Bump version when asking for a new review.
 */
export type PitchKind = 'site' | 'video' | 'slides' | 'ads';
export type Verdict = 'approve' | 'change' | 'drop';
export interface PitchStamp { requestId: string; verdict: Verdict; note?: string; at: number }
export interface PitchPiece {
  id: string; kind: PitchKind; title: string; notes: string[];
  url?: string; youtube?: string; image?: DraftImage; images: DraftImage[]; stamp?: PitchStamp;
}
export interface Pitch { department: string; lead: string; status: 'building' | 'ready'; version: string; pieces: PitchPiece[] }
export interface PitchView { cubbyId: string; floorId: string; computerId: string; pitch: Pitch; notice?: { requestId: string; text: string } }
export interface PitchVerdictMessage extends PitchStamp { pieceId: string; version: string; ownerSig: string }
export type PitchVerdictPayload = { cubbyId: string; floorId: string; computerId: string } & Omit<PitchVerdictMessage, 'ownerSig'>;
export type PitchClientMsg = { t: 'pitch.verdict'; cubbyId: string; floorId: string } & PitchVerdictMessage;
export type PitchServerMsg = { t: 'pitch'; view?: PitchView };
export const PITCH_LIMITS = { pieces: 4, slides: 24, ads: 8, images: 34, note: 1000, feedbackBytes: 64 * 1024 } as const;
export function ownerVerdictEncoding(f: PitchVerdictPayload): string {
  return JSON.stringify(['agent-office/cubby-owner-verdict/v1', f.cubbyId, f.floorId, f.computerId,
    f.requestId, f.at, f.version, f.pieceId, f.verdict, f.note ?? null]);
}
export const pitchImageUrl = (cubbyId: string, hash: string) => `/api/pitch/${encodeURIComponent(cubbyId)}/images/${hash}`;
