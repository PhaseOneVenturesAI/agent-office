// Draft floors (cubbies step 2): a project before its kickoff. Only the people allowed to start
// projects can make one, and a draft is seen by nobody but its owner: it isn't in anyone else's
// elevator, they can't ride to it, and nothing about it reaches their pages. Its lead and helpers run
// on the owner's own computer (the same outbound cubby connection as step 1); the office keeps only
// the draft's name and what that connection last said.

/** One approved or proposed screen, as its wall card shows it. Titles only: no images cross the wire. */
export interface DraftScreen {
  title: string;
  status: 'sketch' | 'review' | 'approved';
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
  decisions: string[];
  plan: string[];
  screens: DraftScreen[];
  brand: DraftBrand;
}

/** A draft as its owner's page shows it (never sent to anyone else). */
export interface DraftView {
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

/** Sent with each floor you arrive on: whether it's one of your drafts, and whether you may start projects. */
export interface DraftsState {
  enabled: boolean;
  /** You may press New project (the office's AGENT_OFFICE_PROJECT_STARTERS names you). */
  canStart: boolean;
  /** The floor you're on, when it's a draft of yours. */
  here?: DraftView;
}

export type DraftsClientMsg =
  /** New project: makes a draft floor and rides you to it. */
  | { t: 'drafts.new'; name: string };

export type DraftsServerMsg =
  | { t: 'drafts'; state: DraftsState }
  /** Your new draft is ready; ride to it. */
  | { t: 'drafts.made'; floorId: string };

/** The longest a draft's name may be. */
export const DRAFT_NAME_MAX = 40;

/** A draft's name as the office keeps it: one line, trimmed, at most DRAFT_NAME_MAX characters. */
export function cleanDraftName(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, DRAFT_NAME_MAX) : '';
}

/** Empty boards, before the owner's computer has said anything. */
export const EMPTY_BOARDS: DraftBoards = { decisions: [], plan: [], screens: [], brand: { colors: [] } };
