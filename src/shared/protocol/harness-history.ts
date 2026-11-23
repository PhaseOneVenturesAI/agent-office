/** Shared Harness source history. This is separate from Apply's provider-home backups. */
export interface HarnessSource {
  path: string;
  text: string | null;
  revision: string;
  status: 'present' | 'missing' | 'unavailable';
}
export interface HarnessRevision {
  id: string;
  path: string;
  action: 'edit' | 'restore' | 'legacy';
  by: string | null;
  /** Capture time, not the unknown original edit time of a legacy backup. */
  at: number;
  before: string;
  after: string;
  restoredFrom?: string;
  hasText: boolean;
  outcome: 'applied' | 'failed' | 'unconfirmed' | 'retained';
}
export type HarnessSnapshot = Omit<HarnessRevision, 'outcome' | 'hasText'> & { text: string | null };
export interface HarnessHistoryPage { revisions: HarnessRevision[]; next?: string }
export type HarnessChange = { path: string; base: string } & (
  | { action: 'edit'; text: string }
  | { action: 'restore'; revision: string }
);
