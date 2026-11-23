// Satellite nodes (see server/nodes.ts): the team's own computers, joined to the office with
// `agent-office join`, on one wall — who's here, what each machine could run, and who's gone
// quiet. This is the presence layer; hiring workers onto a machine from its card is the next
// iteration.

import type { AgentProvider } from '../providers.js';

/** One joined computer, as its last hello described it. */
export interface NodeInfo {
  id: string;
  /** What to call it: the invite's name, else the machine's hostname. */
  name: string;
  /** The machine's own hostname. */
  host: string;
  /** e.g. "macOS arm64", "Linux x64". */
  platform: string;
  cpus: number;
  memGB: number;
  /** The agent CLIs its PATH offers (what could run here). */
  providers: AgentProvider[];
  /** The agent-office version it joined with, when it said. */
  version?: string;
  online: boolean;
  /** Last hello or heartbeat, ms since epoch. */
  lastSeen: number;
  /** When it first joined, ms since epoch. */
  joinedAt: number;
}

export interface NodesState {
  nodes: NodeInfo[];
}

export type NodesClientMsg =
  /** The wall, whenever it changes and when asked. */
  | { t: 'nodes.get' }
  /** Mint a join token for one more machine (admins only); the answer is nodes.token, shown once. */
  | { t: 'nodes.invite'; name?: string }
  /** Take a machine off the office (admins only); an online one is disconnected. */
  | { t: 'nodes.revoke'; id: string };

export type NodesServerMsg =
  | { t: 'nodes'; state: NodesState }
  /** The invite's join token, to the admin who asked. Shown once; the office keeps only its hash. */
  | { t: 'nodes.token'; id: string; name: string; token: string };
