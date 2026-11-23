export interface DeliveryRun {
  key: string;
  id: number;
  attempt: number;
  workflow: string;
  event: string;
  url: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  updatedAt: number;
  /** Run metadata is real; it does not attest a custom checkout, inputs or target. */
  configuration: 'incomplete';
  watcher?: { name: string; mine: boolean; expiresAt: number };
}
export interface DeliveryState {
  number: number;
  repo: string;
  sourceSha: string;
  runs: DeliveryRun[];
  fetchedAt: number;
  loading: boolean;
  error?: string;
}
export type DeliveryClientMsg =
  | { t: 'delivery.open'; number: number }
  | { t: 'delivery.refresh' }
  | { t: 'delivery.watch'; runKey: string }
  | { t: 'delivery.renew'; runKey: string }
  | { t: 'delivery.release'; runKey: string }
  | { t: 'delivery.close' };
export type DeliveryServerMsg = { t: 'delivery.state'; state: DeliveryState };
