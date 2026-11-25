import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { jsonFile } from './io.js';
import { alive } from './lock.js';
import { LeadError, type Lead } from './lead.js';

// The bridge to a lead that's already running: the project's own Claude session (in the Claude app,
// say) rather than a second copy of it. The connector, having checked the owner's signature, drops
// each message in this computer's own inbox (0600, under ~/.agent-office/cubbies/<project>/bridge);
// the lead session keeps `agent-office cubby wait` running in the background, which hands it the
// message and exits, and it answers with `agent-office cubby reply`. Nothing here runs a command,
// opens a file the message names or starts a session: the text reaches the lead's conversation and
// the lead keeps its own rules and permission prompts.

/** How long a waiter's heartbeat counts as the lead listening. */
export const LISTEN_MS = 60_000;
/** How long the connector waits for the lead's answer before giving the message up. */
export const REPLY_MS = 10 * 60_000;
export const NOT_LISTENING = "Your lead isn't listening for cubby chat right now (its session is closed or between tasks). Nothing was queued; try again shortly or open it on your computer.";

export interface BridgeMessage { requestId: string; at: number; text: string }

export function bridgeDirs(state: string) {
  const root = path.join(state, 'bridge');
  return { root, inbox: path.join(root, 'inbox'), claimed: path.join(root, 'claimed'), outbox: path.join(root, 'outbox'), listening: path.join(root, 'listening.json') };
}

function ensure(state: string) {
  const d = bridgeDirs(state);
  for (const dir of [d.root, d.inbox, d.claimed, d.outbox]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return d;
}

/** Writes `value` as JSON to `file` all at once (0600). */
function put(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

const remove = (file: string) => { try { unlinkSync(file); } catch { /* already gone */ } };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

/** Whether a lead session is waiting for cubby chat right now. */
export function listening(state: string, now = Date.now(), isAlive = alive): boolean {
  try {
    const l = jsonFile(bridgeDirs(state).listening, 4096);
    return Number.isSafeInteger(l.pid) && l.pid > 1 && (l.between === true || isAlive(l.pid)) && typeof l.at === 'number' && now - l.at < LISTEN_MS;
  } catch { return false; }
}

/** The connector's side: hands each verified owner message to the waiting lead session and waits for its answer. */
export class BridgeLead implements Lead {
  private running = false;
  private abort?: AbortController;
  constructor(private state: string, private now = Date.now, private poll = 400, private isAlive = alive) {}
  get busy() { return this.running; }
  readonly blocker = undefined;

  async send(text: string, signal: AbortSignal): Promise<string> {
    if (this.running) throw new LeadError('Project lead is busy');
    if (!listening(this.state, this.now(), this.isAlive)) throw new LeadError(NOT_LISTENING);
    this.running = true;
    const stop = new AbortController();
    this.abort = stop;
    const d = ensure(this.state);
    const requestId = randomUUID();
    const inbox = path.join(d.inbox, `${requestId}.json`);
    const claimed = path.join(d.claimed, `${requestId}.json`);
    const outbox = path.join(d.outbox, `${requestId}.json`);
    try {
      put(inbox, { requestId, at: this.now(), text } satisfies BridgeMessage);
      const until = this.now() + REPLY_MS;
      while (!signal.aborted && !stop.signal.aborted) {
        if (existsSync(outbox)) {
          const r = jsonFile(outbox, 64 * 1024);
          if (r.requestId !== requestId || typeof r.text !== 'string') throw new LeadError('The lead\'s answer was unreadable');
          return r.text.slice(0, 8000) || 'The lead answered without any text.';
        }
        if (this.now() > until) throw new LeadError('Your lead did not answer within ten minutes; check its session on your computer.');
        // A message nobody picked up while the waiter went away is taken back, never left to run later.
        if (existsSync(inbox) && !listening(this.state, this.now(), this.isAlive)) throw new LeadError(NOT_LISTENING);
        await delay(this.poll);
      }
      throw new LeadError('Turn cancelled');
    } finally {
      remove(inbox);
      remove(claimed);
      remove(outbox);
      this.running = false;
      if (this.abort === stop) this.abort = undefined;
    }
  }

  async stop(): Promise<void> { this.abort?.abort(); }
}

/**
 * The lead session's side: waits (heartbeating so the connector knows it's listening) until a message
 * is in the inbox, claims it and returns it; undefined when `timeoutMs` passes first.
 */
export async function waitForMessage(state: string, timeoutMs: number, signal?: AbortSignal, poll = 500): Promise<BridgeMessage | undefined> {
  const d = ensure(state);
  const until = Date.now() + timeoutMs;
  let beat = 0;
  try {
    while (!signal?.aborted && Date.now() < until) {
      if (Date.now() - beat > 15_000) { put(d.listening, { pid: process.pid, at: Date.now() }); beat = Date.now(); }
      const files = readdirSync(d.inbox).filter((f) => /^[a-zA-Z0-9_-]{1,128}\.json$/.test(f)).sort();
      for (const f of files) {
        let m: any;
        try { m = jsonFile(path.join(d.inbox, f), 64 * 1024); } catch { continue; }
        if (!validId(m.requestId) || typeof m.text !== 'string' || typeof m.at !== 'number') continue;
        // Claimed: moved out of the inbox, so the connector waits for the answer instead of giving it up.
        try { renameSync(path.join(d.inbox, f), path.join(d.claimed, f)); } catch { continue; }
        return { requestId: m.requestId, at: m.at, text: m.text };
      }
      await delay(poll);
    }
    return undefined;
  } finally {
    // Between messages (while the lead reads and answers one) it still counts as listening for a
    // minute, so the next message waits for it to re-arm instead of bouncing.
    put(d.listening, { pid: process.pid, at: Date.now(), between: true });
  }
}

/** The lead's answer to one message. */
export function writeReply(state: string, requestId: string, text: string): void {
  if (!validId(requestId)) throw new Error('Unknown request id');
  const d = ensure(state);
  if (!existsSync(path.join(d.claimed, `${requestId}.json`))) throw new Error('That message is no longer waiting for an answer');
  put(path.join(d.outbox, `${requestId}.json`), { requestId, text: text.slice(0, 8000) });
}
