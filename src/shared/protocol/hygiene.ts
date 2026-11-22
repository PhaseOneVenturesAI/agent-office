// The hygiene watchdog (see server/hygiene.ts): the mess that regrows in a busy office, found
// before it bites — commits no remote has, worktrees no worker sits in anymore, and workers whose
// pull requests merged but who never went home — with one-click cleanup.

export interface HygieneUnpushed {
  branch: string;
  commits: number;
}

export interface HygieneStale {
  /** Relative to the project's dir. */
  path: string;
  branch?: string;
}

export interface HygieneIdle {
  id: string;
  name: string;
  /** Why it can go: "PR #12 merged". */
  why: string;
}

export interface HygieneFloor {
  id: string;
  name: string;
  /** Why this floor couldn't be scanned, when it couldn't. */
  error?: string;
  unpushed: HygieneUnpushed[];
  /** Worktrees no worker of the building uses, safe to prune. */
  stale: HygieneStale[];
  /** Folders left in the worktrees dir that git no longer tracks: reported, never auto-removed. */
  strays: string[];
  idle: HygieneIdle[];
}

export interface HygieneState {
  scanning?: boolean;
  /** When the last scan finished, ms. */
  scannedAt?: number;
  floors: HygieneFloor[];
  /** Every finding across the building, for the menu's count. */
  findings: number;
}

export type HygieneClientMsg =
  /** The report, whenever it changes and when asked. */
  | { t: 'hygiene.get' }
  /** Scan every floor again. */
  | { t: 'hygiene.scan' }
  /** Remove a floor's stale worktrees that hold no work (admins only). */
  | { t: 'hygiene.prune'; floor: string }
  /** Send a worker whose pull request merged home (admins only). */
  | { t: 'hygiene.home'; floor: string; worker: string };

export type HygieneServerMsg = { t: 'hygiene'; state: HygieneState };
