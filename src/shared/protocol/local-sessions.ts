// Deliberately no free text, paths, prompts, ownership inference or execution messages.
export const LOCAL_STATES = ['starting', 'working', 'running', 'waiting', 'idle', 'stopped', 'error', 'unknown'] as const;
export type LocalState = typeof LOCAL_STATES[number];
export interface LocalSession {
  floorId: string;
  workspaceId: string;
  terminalId: string;
  provider: 'claude' | 'codex' | 'kimi' | 'unknown';
  state: LocalState;
  lastEventAt: number | null;
  exited: boolean;
}
export interface LocalSnapshot {
  observedAt: number;
  collection: 'ok' | 'partial' | 'unavailable';
  sessions: LocalSession[];
}
export const SNAPSHOT_FRESH_MS = 90_000;
export const EVENT_FRESH_MS = 5 * 60_000;
export const LOCAL_ID = /^[a-zA-Z0-9_-]{1,80}$/;

/** Only an observation; a fresh hook is not proof of ownership, readiness or completion. */
export function localObservation(s: LocalSession, snapshot: LocalSnapshot, online: boolean, now = Date.now()): string {
  if (!online || now - snapshot.observedAt > SNAPSHOT_FRESH_MS || !s.lastEventAt || now - s.lastEventAt > EVENT_FRESH_MS) return `Stale observation · last reported ${s.state}`;
  if (s.exited) return 'Terminal exited · outcome unknown';
  return `Recently observed · ${s.state}`;
}
