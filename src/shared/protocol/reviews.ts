// The Review Room (see server/reviews.ts): where staged deliverables wait for a human verdict.
// A worker finishing a creative task stages its one link; anyone in the office accepts or rejects
// it with a reason, and every verdict goes into the harness's review ratchet so the next worker
// starts from what was learned.

/** What the brand-gate said when the worker ran it before staging. */
export type ReviewGate = 'passed' | 'failed';

export interface ReviewItem {
  id: string;
  /** What it is, short: "Homepage hero v3". */
  title: string;
  /** The one staged link to look at. */
  url: string;
  /** Anything the reviewer should know. */
  note?: string;
  gate?: ReviewGate;
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
  | { t: 'reviews.submit'; title: string; url: string; note?: string; gate?: ReviewGate }
  /** Accept (ok) or reject it, with the reason the ratchet should remember. */
  | { t: 'reviews.resolve'; id: string; ok: boolean; reason: string };

export type ReviewsServerMsg = { t: 'reviews'; state: ReviewsState };
