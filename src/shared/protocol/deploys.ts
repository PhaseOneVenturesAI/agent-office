// The Deploy board (see server/deploys.ts): the office's Cloudflare Pages and Workers projects,
// and the bridge to the Review Room — any deployment can be staged for a verdict in one click.

export interface DeployItem {
  id: string;
  name: string;
  kind: 'pages' | 'worker';
  /** Where it can be looked at, when it has a public URL. */
  url?: string;
  /** Its last change (a deployment, an edit), ms. */
  updatedAt?: number;
  /** One line more: the production branch, whether the worker is enabled. */
  meta?: string;
}

export interface DeploysState {
  /** Whether the office has Cloudflare credentials; without them the board explains how. */
  configured: boolean;
  items: DeployItem[];
  /** When the list was last fetched, ms. */
  fetchedAt?: number;
  /** Why the last fetch failed, when it did. */
  error?: string;
}

export type DeploysClientMsg =
  /** The board, whenever it changes and when asked. */
  | { t: 'deploys.get' }
  /** Fetch the projects from Cloudflare again. */
  | { t: 'deploys.refresh' }
  /** Stage one deployment in the Review Room. */
  | { t: 'deploys.stage'; id: string };

export type DeploysServerMsg = { t: 'deploys'; state: DeploysState };
