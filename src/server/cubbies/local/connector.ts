import os from 'node:os';
import type { CubbyBinding, CubbyNodeFrame, CubbyRelayFrame } from '../../../shared/protocol/cubbies.js';
import { cubbyKey, verifyRelay } from '../wire.js';
import type { LocalConfig } from './config.js';
import { persistSelection } from './config.js';
import { clean } from './io.js';
import { projectLock } from './lock.js';
import { LeadError, NativeLead, type Lead } from './lead.js';
import { roster } from './roster.js';

type Send = (frame: CubbyNodeFrame) => void;
const bindingKeys = ['cubbyId', 'floorId', 'ownerId', 'connectionId'] as const;
const MAX_SEEN = 16_384;
export interface ConnectorDeps {
  lead?: Lead; snapshot?: () => Promise<Extract<CubbyNodeFrame, { t: 'cubby.snapshot' }>>; now?: () => number;
  release?: () => void;
}

/** One object survives websocket reconnects; no queue and no automatic work resume. */
export class CubbyConnector {
  private send?: Send;
  private binding?: CubbyBinding;
  private timer?: NodeJS.Timeout;
  private abort?: AbortController;
  private generation = 0;
  private seen = new Map<string, number>();
  private connections = new Set<string>();
  private lead: Lead;
  private release: () => void;
  private now: () => number;
  private key: string;
  private closed = false;
  private polling = false;
  constructor(private config: LocalConfig, token: string, private deps: ConnectorDeps = {}) {
    this.key = cubbyKey(token); this.now = deps.now ?? Date.now;
    this.release = deps.release ?? projectLock(config.state);
    try { if (!deps.release) persistSelection(config); }
    catch (error) { this.release(); throw error; }
    this.lead = deps.lead ?? new NativeLead(config);
  }
  get notice() { return this.lead.blocker; }
  connected(send: Send, computerName = os.hostname()): void {
    if (this.closed) return;
    this.disconnected();
    this.send = send;
    send({ t: 'cubby.hello', floorId: this.config.floor, computerId: this.config.computerId, computerName: clean(computerName, 120) });
  }
  receive(data: string | Buffer | ArrayBuffer | Buffer[]): void {
    const size = Array.isArray(data) ? data.reduce((n, part) => n + part.length, 0) : typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (!this.send || this.closed || size > 16 * 1024) return;
    const raw = typeof data === 'string' ? data : Array.isArray(data) ? Buffer.concat(data).toString('utf8')
      : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
    let frame: CubbyRelayFrame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (!frame || (frame.t !== 'cubby.ready' && frame.t !== 'cubby.chat')) return;
    const allowed = new Set(['t', 'signature', ...bindingKeys, ...(frame.t === 'cubby.chat' ? ['requestId', 'at', 'text'] : [])]);
    if (Object.keys(frame).some((key) => !allowed.has(key)) ||
      bindingKeys.some((key) => typeof frame[key] !== 'string' || !frame[key] || frame[key].length > 128) ||
      frame.floorId !== this.config.floor || !verifyRelay(this.key, frame)) return;
    if (frame.t === 'cubby.ready') {
      if (this.binding || this.connections.has(frame.connectionId) || this.connections.size >= MAX_SEEN) return;
      this.connections.add(frame.connectionId);
      this.binding = Object.fromEntries(bindingKeys.map((key) => [key, frame[key]])) as unknown as CubbyBinding;
      void this.snapshot();
      this.timer = setInterval(() => void this.snapshot(), 15_000);
      return;
    }
    if (!this.binding || bindingKeys.some((key) => frame[key] !== this.binding![key]) ||
      typeof frame.text !== 'string' || !frame.text.trim() || frame.text.length > 8000 ||
      typeof frame.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(frame.requestId) ||
      !Number.isSafeInteger(frame.at) || Math.abs(this.now() - frame.at) > 60_000) return;
    // Keep all IDs for this join process, across reconnects. Saturation fails closed.
    if (this.seen.has(frame.requestId) || this.seen.size >= MAX_SEEN) return;
    this.seen.set(frame.requestId, frame.at);
    if (this.abort || this.lead.busy) { this.reply(frame.requestId, 'Project lead is busy; send a new message when it is free.', true); return; }
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    void this.lead.send(frame.text, abort.signal).then(
      (answer) => { if (this.generation === generation && !abort.signal.aborted) this.reply(frame.requestId, answer); },
      (error) => { if (this.generation === generation && !abort.signal.aborted) this.reply(frame.requestId,
        error instanceof LeadError ? error.message : 'Local lead unavailable; inspect its native terminal.', true); },
    ).finally(() => { if (this.abort === abort) this.abort = undefined; });
  }
  private reply(requestId: string, text: string, error = false): void {
    if (this.binding) this.send?.({ t: 'cubby.reply', floorId: this.config.floor, requestId,
      text: text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 8000), ...(error ? { error } : {}) });
  }
  private async snapshot(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const frame = await (this.deps.snapshot?.() ?? roster(this.config));
      if (this.lead.blocker) frame.error = [frame.error, this.lead.blocker].filter(Boolean).join('; ');
      if (this.lead.busy) frame.agents = frame.agents.filter((a) => a.role !== 'lead').slice(0, 127).concat({
        id: `lead:${this.config.session}`, tool: this.config.provider, role: 'lead', task: 'Owner chat',
        branch: clean(this.config.branches.get(this.config.project)), status: 'working' });
      if (generation === this.generation && this.binding && Buffer.byteLength(JSON.stringify(frame)) <= 64 * 1024) this.send?.(frame);
    } catch { /* source failure is retried at the next bounded interval */ }
    finally { this.polling = false; }
  }
  disconnected(): void {
    this.generation++; this.send = undefined; this.binding = undefined;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.abort?.abort();
    void this.lead.stop();
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.disconnected();
    await this.lead.stop(); this.release();
  }
}
