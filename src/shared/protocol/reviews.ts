// The Review Room (see server/reviews.ts): where staged deliverables wait for a human verdict.
// A worker finishing a creative task stages its one link; anyone in the office accepts or rejects
// it with a reason. Verdicts remain review evidence; they never become global instructions.

/** What the brand-gate said when the worker ran it before staging. */
export type ReviewGate = 'passed' | 'failed';

/** What kind of take it is; inferred from the link when the stager didn't say. */
export type ReviewKind = 'page' | 'video' | 'image' | 'link';

/** The creative pipeline a take moves through; each move carries an evidence note. */
export type ReviewStageName = 'built' | 'verified' | 'staged' | 'approved' | 'released';

/** One move along the pipeline, with the evidence for it. */
export interface ReviewStage {
  stage: ReviewStageName;
  by: string;
  at: number;
  /** Why it's at this stage: what was checked, where it ran. */
  note: string;
}

export interface ReviewItem {
  id: string;
  /** What it is, short: "Homepage hero v3". */
  title: string;
  /** The one staged link to look at. */
  url: string;
  /** Anything the reviewer should know. */
  note?: string;
  gate?: ReviewGate;
  kind?: ReviewKind;
  /** The creative it versions, e.g. "homepage hero"; takes of one group stack together. */
  group?: string;
  /** Its version inside the group, e.g. "v3". */
  version?: string;
  /** Reference links the take was judged against (mood board, last winner). */
  references?: string[];
  /** Its pipeline so far, in order. */
  stages?: ReviewStage[];
  /** Who staged it: a worker's or a person's name. */
  by: string;
  /** The worker to send the verdict back to, when a worker staged it. */
  workerId?: string;
  /** The floor that worker sits on, when there is one. */
  floorId?: string;
  at: number;
  status: 'pending' | 'accepted' | 'rejected';
  verdict?: { by: string; reason: string; at: number };
}

export interface ReviewsState {
  /** Newest first. */
  items: ReviewItem[];
  /** How many are waiting for a verdict. */
  pending: number;
}

export type ReviewsClientMsg =
  /** The board, whenever it changes and when asked. */
  | { t: 'reviews.get' }
  /** Stage a link for review yourself. */
  | { t: 'reviews.submit'; title: string; url: string; note?: string; gate?: ReviewGate; kind?: ReviewKind; group?: string; version?: string; references?: string[] }
  /** Accept (ok) or reject it, with a reason about this deliverable. */
  | { t: 'reviews.resolve'; id: string; ok: boolean; reason: string }
  /** Move it along the pipeline, with the evidence note for the move. */
  | { t: 'reviews.stage'; id: string; stage: ReviewStageName; note: string };

export type ReviewsServerMsg = { t: 'reviews'; state: ReviewsState };
