// Draft floors (cubbies step 2): a project before its kickoff. Only the people allowed to start
// projects can make one, and a draft is seen by nobody but its owner: it isn't in anyone else's
// elevator, they can't ride to it, and nothing about it reaches their pages. Its lead and helpers run
// on the owner's own computer (the same outbound cubby connection as step 1); the office keeps only
// the draft's name and what that connection last said.

/**
 * The owner's note on a card (cubbies step 5), authorized by the HQ owner's account and saved on the owner's
 * computer next to draft.json (`.agent-office/feedback.json`). The office only shows what the computer reports.
 */
export interface DraftFeedback { id: string; text: string; at: number }

/**
 * A design image on the board, as the owner's computer sent it: a PNG, JPEG or WebP file from the
 * project's `.agent-office/design/`, checked by its contents and with its metadata (EXIF, GPS, XMP,
 * comments) removed before it leaves the computer. `hash` is the SHA-256 (hex) of the cleaned bytes;
 * the owner's page loads it from `/api/drafts/<floorId>/images/<hash>`, which only the owner may read.
 */
export interface DraftImage { hash: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }

/** One approved or proposed screen, as its wall card shows it. */
export interface DraftScreen {
  version?: number;
  /** Stable card id from draft.json (else made from the title). */
  id: string;
  title: string;
  status: 'sketch' | 'review' | 'approved';
  note?: string;
  image?: DraftImage;
  feedback: DraftFeedback[];
}

/** An idea card (step 5): the board where the project is worked out before screens. */
export interface DraftIdea {
  id: string;
  title: string;
  note?: string;
  image?: DraftImage;
  feedback: DraftFeedback[];
}

/** The brand wall (where the TV is on an open floor). */
export interface DraftBrand {
  name?: string;
  tagline?: string;
  /** Up to six #rrggbb colors. */
  colors: string[];
}

/** What the owner's computer last said about the draft, from its local `.agent-office/draft.json`. */
export interface DraftBoards {
  ideas: DraftIdea[];
  decisions: string[];
  plan: string[];
  screens: DraftScreen[];
  brand: DraftBrand;
}

/** A draft as its owner's page shows it (never sent to anyone else). */
export interface DraftView {
  studio?: true;
  id: string;
  name: string;
  createdAt: number;
  /** The cubby that connects this draft to the owner's computer (set up at the studio table). */
  cubbyId?: string;
  leadName?: string;
  /** Whether the owner's computer is connected right now. */
  online: boolean;
  boards: DraftBoards;
  /** Screen-drawing helpers working now: each uncovers one pod of desks (at most two pods). */
  designers: number;
}

/**
 * What a kicked-off project keeps for everyone (cubbies step 3): the Design book on the bookshelf and
 * the brand poster by the elevator. Text only, from the draft's last boards.
 */
export interface Launched {
  name: string;
  at: number;
  /** owner/name when the repository is on GitHub; absent for a local test remote. */
  repo?: string;
  brand: DraftBrand;
  /** The approved screens' titles, for the Design book. */
  screens: string[];
}

/** Sent with each floor you arrive on: whether it's one of your drafts, and whether you may start projects. */
export interface DraftsState {
  studio?: boolean;
  enabled: boolean;
  /** You may press New project as the signed-in HQ owner through Mac Studio. */
  canStart: boolean;
  /** The floor you're on, when it's a draft of yours. */
  here?: DraftView;
  /** Whether this office can kick a draft off (a kickoff remote is configured); false shows why not. */
  canKickoff?: boolean;
  /** The floor you're on, when it was kicked off from a draft (for everyone on it). */
  launched?: Launched;
}

export type DraftsClientMsg =
  /** New project: makes a draft floor and rides you to it. */
  | { t: 'drafts.new'; name: string }
  /** Kick off (cubbies step 3): `confirm` must be the draft's name, typed again. */
  | { t: 'drafts.kickoff'; floorId: string; confirm: string }
  /** Feedback on one card (step 5), authorized by the HQ owner's account and sent over the Mac link. */
  | ({ t: 'drafts.feedback'; floorId: string } & DraftFeedbackMessage);

export type DraftsServerMsg =
  | { t: 'drafts'; state: DraftsState }
  /** Your new draft is ready; ride to it. */
  | { t: 'drafts.made'; floorId: string }
  /** A draft was kicked off and is open to everyone now (sent to everyone in the building). */
  | { t: 'drafts.kicked'; floorId: string; name: string; by: string }
  /** Your kickoff couldn't finish; nothing changed (sent to the owner only). */
  | { t: 'drafts.kickoffFailed'; floorId: string; error: string };

/** How long a kicked-off floor wears its "New" badge in the elevator. */
export const NEW_BADGE_MS = 3 * 24 * 60 * 60_000;

/** The longest a draft's name may be. */
export const DRAFT_NAME_MAX = 40;

/** A draft's name as the office keeps it: one line, trimmed, at most DRAFT_NAME_MAX characters. */
export function cleanDraftName(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, DRAFT_NAME_MAX) : '';
}

/** Empty boards, before the owner's computer has said anything. */
export const EMPTY_BOARDS: DraftBoards = { ideas: [], decisions: [], plan: [], screens: [], brand: { colors: [] } };

/** A note on a card, sent by the signed-in owner. */
export interface DraftFeedbackMessage { cardId: string; text: string; requestId: string; at: number }

/** Limits on what a board carries (enforced on the computer and again at the office). */
export const DRAFT_LIMITS = {
  ideas: 16, screens: 24, feedbackPerCard: 20, feedbackText: 1000, note: 400,
  /** Aggregate escaped UTF-8 text bytes plus 192 bytes per note (ID, timestamp and JSON). */
  feedbackBytes: 16 * 1024, feedbackNoteOverhead: 192,
  /** Images on one draft, and the largest one after cleaning. */
  images: 16, imageBytes: 2 * 1024 * 1024, imagePixels: 16_000_000,
  /** Base64 characters per image chunk frame (the node socket's frames stay well under 64 KB). */
  chunk: 48 * 1024,
} as const;
/** The URL the owner's page loads a board image from. */
export const draftImageUrl = (floorId: string, hash: string) => `/api/drafts/${encodeURIComponent(floorId)}/images/${hash}`;

/** Bound decoded memory as well as encoded bytes, before any browser fetch or local transfer. */
export function validDraftImageSize(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= 16384 && height <= 16384 && width * height <= DRAFT_LIMITS.imagePixels;
}
