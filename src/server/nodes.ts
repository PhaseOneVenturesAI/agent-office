// Satellite nodes: the team's own computers, joined with `agent-office join <office> --token …`
// (see join.ts). An admin mints a join token in ☰ → 🛰️ Satellites; the office keeps only its
// hash. A node opens a WebSocket to /ws/node?token=…, says hello with what its machine is and
// which agent CLIs its PATH offers, and heartbeats until it goes — the wall in the office
// follows. This is the presence layer: who could run work here. Routing a hire onto a node is
// the next iteration.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type { AgentProvider } from '../shared/providers.js';
import { isAgentProvider } from '../shared/providers.js';
import type { NodeInfo, NodesState } from '../shared/protocol.js';
import type { LocalSnapshot } from '../shared/protocol/local-sessions.js';
import { readSnapshot } from './local-sessions/schema.js';

/** What a satellite sends: the hello first, then heartbeats. */
export type NodeFrame =
  | { t: 'hello'; name?: string; host: string; platform: string; cpus: number; memGB: number; providers: string[]; version?: string }
  | { t: 'ping'; memFreeGB?: number }
  | { t: 'local.snapshot'; snapshot: LocalSnapshot };

/** Silent this long and the node counts as gone quiet. */
const STALE_MS = 60_000;
const SWEEP_MS = 20_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

interface SavedNode {
  id: string;
  /** The invite's label, when one was given; the hello's name wins while it's here. */
  name: string;
  /** sha256 of the join token; the token itself is only ever shown once, at invite time. */
  token: string;
  joinedAt: number;
}

interface LiveNode extends SavedNode {
  ws?: WebSocket;
  /** What the machine said it is, from its last hello. */
  hello?: { name: string; host: string; platform: string; cpus: number; memGB: number; providers: AgentProvider[]; version?: string };
  lastSeen: number;
  snapshot?: LocalSnapshot;
}

export class Nodes {
  private file: string;
  private nodes = new Map<string, LiveNode>();
  private sweeper: NodeJS.Timeout;

  constructor(
    dataDir: string,
    private onChange: () => void,
  ) {
    this.file = path.join(dataDir, 'nodes.json');
    this.load();
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  state(floorId?: string): NodesState {
    const nodes = [...this.nodes.values()]
      .map((n): NodeInfo => {
        const online = !!n.ws && Date.now() - n.lastSeen < STALE_MS;
        return {
          id: n.id,
          name: n.hello?.name || n.name || n.hello?.host || n.id,
          host: n.hello?.host ?? '',
          platform: n.hello?.platform ?? '',
          cpus: n.hello?.cpus ?? 0,
          memGB: n.hello?.memGB ?? 0,
          providers: n.hello?.providers ?? [],
          ...(n.hello?.version ? { version: n.hello.version } : {}),
          online,
          lastSeen: n.lastSeen,
          joinedAt: n.joinedAt,
          ...(floorId && n.snapshot ? { localSessions: { ...n.snapshot, sessions: n.snapshot.sessions.filter((s) => s.floorId === floorId) } } : {}),
        };
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return { nodes };
  }

  /** Mints a join token; the node exists from here, the token is answered with and forgotten. */
  invite(name?: string): { id: string; name: string; token: string } {
    const id = randomBytes(4).toString('hex');
    const token = `ao_node_${randomBytes(24).toString('hex')}`;
    const label = (name ?? '').trim().slice(0, 60);
    this.nodes.set(id, { id, name: label, token: hash(token), joinedAt: Date.now(), lastSeen: 0 });
    this.save();
    this.onChange();
    return { id, name: label || id, token };
  }

  /** Takes a node off the office; an online one is disconnected first. */
  revoke(id: string): boolean {
    const n = this.nodes.get(id);
    if (!n) return false;
    try {
      n.ws?.close(4000, 'revoked');
    } catch {
      // already gone
    }
    this.nodes.delete(id);
    this.save();
    this.onChange();
    return true;
  }

  /** Whether a token from /ws/node's query is one we minted. */
  known(token: string): boolean {
    const h = hash(token);
    for (const n of this.nodes.values()) if (n.token === h) return true;
    return false;
  }

  /**
   * A satellite's socket: the hello must be its first frame, with a token we minted. Anything
   * else, or a first frame that never comes, closes it. Heartbeats just say "still here".
   */
  attach(ws: WebSocket, token: string) {
    const h = hash(token);
    const node = [...this.nodes.values()].find((n) => n.token === h);
    if (!node) {
      ws.close(4001, 'unknown token');
      return;
    }
    // One machine, one socket: a reconnect replaces the one that dropped.
    try {
      node.ws?.close(4002, 'replaced');
    } catch {
      // already gone
    }
    node.ws = ws;
    node.lastSeen = 0;
    let helloReceived = false;
    const greeted = setTimeout(() => ws.close(4003, 'no hello'), 10_000);
    ws.on('message', (raw) => {
      // A replaced/revoked socket cannot refresh presence or submit another node's observations.
      const size = Array.isArray(raw) ? raw.reduce((n, b) => n + b.byteLength, 0) : raw.byteLength;
      if (this.nodes.get(node.id) !== node || node.ws !== ws || size > 64 * 1024) return;
      let frame: NodeFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if (!helloReceived) {
        if (frame.t !== 'hello') return;
        clearTimeout(greeted);
        helloReceived = true;
        node.hello = {
          name: typeof frame.name === 'string' ? frame.name.slice(0, 60) : '',
          host: String(frame.host ?? '').slice(0, 120),
          platform: String(frame.platform ?? '').slice(0, 60),
          cpus: Math.min(Math.max(Number(frame.cpus) || 0, 0), 1024),
          memGB: Math.min(Math.max(Number(frame.memGB) || 0, 0), 16 * 1024),
          providers: (Array.isArray(frame.providers) ? frame.providers : []).filter(isAgentProvider) as AgentProvider[],
          ...(typeof frame.version === 'string' ? { version: frame.version.slice(0, 30) } : {}),
        };
        if (node.hello.name) {
          node.name = node.hello.name;
          this.save();
        }
      } else if (frame.t === 'local.snapshot') {
        const snapshot = readSnapshot(frame.snapshot);
        if (!snapshot || (node.snapshot && snapshot.observedAt <= node.snapshot.observedAt)) return;
        node.snapshot = snapshot;
      } else if (frame.t !== 'ping') {
        return;
      }
      node.lastSeen = Date.now();
      this.onChange();
    });
    ws.on('close', () => {
      clearTimeout(greeted);
      if (node.ws === ws) {
        node.ws = undefined;
        node.lastSeen = Date.now();
        this.onChange();
      }
    });
    ws.on('error', () => ws.close());
  }

  close() {
    clearInterval(this.sweeper);
    for (const n of this.nodes.values()) {
      try {
        n.ws?.close(1001, 'office closing');
      } catch {
        // already gone
      }
    }
  }

  /** A node that stopped heartbeating without closing counts as offline, once. */
  private sweep() {
    let changed = false;
    const now = Date.now();
    for (const n of this.nodes.values()) {
      if (n.ws && now - n.lastSeen >= STALE_MS) {
        try {
          n.ws.close(4004, 'quiet');
        } catch {
          // already gone
        }
        n.ws = undefined;
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const n of Array.isArray(saved?.nodes) ? saved.nodes : []) {
        if (!n || typeof n.id !== 'string' || typeof n.token !== 'string') continue;
        this.nodes.set(n.id, { id: n.id, name: typeof n.name === 'string' ? n.name : '', token: n.token, joinedAt: Number(n.joinedAt) || Date.now(), lastSeen: 0 });
      }
    } catch {
      // corrupt file: start fresh
    }
  }

  private save() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const nodes: SavedNode[] = [...this.nodes.values()].map(({ id, name, token, joinedAt }) => ({ id, name, token, joinedAt }));
      writeFileSync(this.file, JSON.stringify({ nodes }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
