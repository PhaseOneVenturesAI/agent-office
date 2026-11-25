import os from 'node:os';
import type { CubbyBinding, CubbyNodeFrame, CubbyRelayFrame } from '../../../shared/protocol/cubbies.js';
import { cubbyKey, verifyOwner, verifyOwnerDevice, verifyRelay } from '../wire.js';
import { ask, change, devicesFrame, fileStore, type DeviceStore } from './devices.js';
import type { LocalConfig } from './config.js';
import { persistSelection } from './config.js';
import { clean } from './io.js';
import { projectLock } from './lock.js';
import { LeadError, NativeLead, type Lead } from './lead.js';
import { roster } from './roster.js';
import { execFileSync } from 'node:child_process';
import { BridgeLead } from './bridge.js';
import { commitsSince, headOf, loadSeen, saveSeen, wakeSummary } from './wake.js';
import { run } from './io.js';

type Send = (frame: CubbyNodeFrame) => void;
const bindingKeys = ['cubbyId', 'floorId', 'ownerId', 'connectionId', 'computerId'] as const;
const MAX_SEEN = 16_384;
export interface ConnectorDeps {
  lead?: Lead; snapshot?: () => Promise<Extract<CubbyNodeFrame, { t: 'cubby.snapshot' }>>; now?: () => number;
  release?: () => void;
  /** The project's HEAD now, for the wake summary's commit count (default: git). */
  head?: () => Promise<string | undefined>;
  commits?: (from?: string, to?: string) => Promise<number | undefined>;
  /** What was last seen before going away (tests; otherwise read from the local state). */
  seen?: () => import('./wake.js').Seen | undefined;
  /** Who's trusted to talk to the lead (default: the project's files, see devices.ts). */
  devices?: DeviceStore;
}
const FRAME_KEYS: Record<string, string[]> = {
  'cubby.ready': [], 'cubby.chat': ['requestId', 'at', 'text', 'ownerSig'],
  'cubby.device-request': ['requestId', 'at', 'publicKey', 'label'], 'cubby.device': ['requestId', 'at', 'action', 'target', 'ownerSig'],
};

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
  /** Set by each new binding: its first snapshot says what changed while the cubby was away. */
  private waking = false;
  private devices: DeviceStore;
  constructor(private config: LocalConfig, token: string, private deps: ConnectorDeps = {}) {
    this.key = cubbyKey(token); this.now = deps.now ?? Date.now;
    this.devices = deps.devices ?? fileStore(config.state, config.floor, config.ownerKey);
    this.release = deps.release ?? projectLock(config.state);
    try { if (!deps.release) persistSelection(config); }
    catch (error) { this.release(); throw error; }
    this.lead = deps.lead ?? (config.bridge ? new BridgeLead(config.state) : new NativeLead(config));
  }
  get notice() { return this.lead.blocker; }
  connected(send: Send, computerName = friendlyName()): void {
    if (this.closed) return;
    this.disconnected();
    this.send = send;
    send({ t: 'cubby.hello', floorId: this.config.floor, computerId: this.config.computerId, computerName: clean(computerName, 120) });
  }
  receive(data: string | Buffer | ArrayBuffer | Buffer[]): void {
    const size = Array.isArray(data) ? data.reduce((n, part) => n + part.length, 0) : typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (!this.send || this.closed || size > 64 * 1024) return;
    const raw = typeof data === 'string' ? data : Array.isArray(data) ? Buffer.concat(data).toString('utf8')
      : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
    let frame: CubbyRelayFrame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (!frame || typeof frame.t !== 'string' || !Object.hasOwn(FRAME_KEYS, frame.t)) return;
    const allowed = new Set(['t', 'signature', ...bindingKeys, ...FRAME_KEYS[frame.t]]);
    if (Object.keys(frame).some((key) => !allowed.has(key)) ||
      bindingKeys.some((key) => typeof frame[key] !== 'string' || !frame[key] || frame[key].length > 128) ||
      frame.floorId !== this.config.floor || frame.computerId !== this.config.computerId || !verifyRelay(this.key, frame)) return;
    if (frame.t === 'cubby.ready') {
      if (this.binding || this.connections.has(frame.connectionId) || this.connections.size >= MAX_SEEN) return;
      this.connections.add(frame.connectionId);
      this.binding = Object.fromEntries(bindingKeys.map((key) => [key, frame[key]])) as unknown as CubbyBinding;
      this.waking = true;
      this.sendDevices();
      void this.snapshot();
      this.timer = setInterval(() => void this.snapshot(), 15_000);
      return;
    }
    if (!this.binding || bindingKeys.some((key) => frame[key] !== this.binding![key]) ||
      typeof frame.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(frame.requestId) || !Number.isSafeInteger(frame.at)) return;
    if (frame.t === 'cubby.device-request' || frame.t === 'cubby.device') { this.device(frame); return; }
    if (typeof frame.text !== 'string' || !frame.text.trim() || frame.text.length > 8000) return;
    if (!this.trusted((key) => verifyOwner(key, frame))) {
      this.reply(frame.requestId, "Message not signed by this cubby's owner key", true); return;
    }
    if (Math.abs(this.now() - frame.at) > 60_000) { this.reply(frame.requestId, 'Message expired or computer clocks disagree. Check the computer clock and send again.', true); return; }
    // Keep all IDs for this join process, across reconnects. Saturation fails closed.
    if (this.seen.has(frame.requestId)) return;
    if (this.seen.size >= MAX_SEEN) { this.reply(frame.requestId, 'Restart the local connector before sending more messages.', true); return; }
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
  /** Whether one of the trusted devices made this signature (a damaged trust record trusts nobody). */
  private trusted(check: (key: string) => boolean): boolean {
    try { return this.devices.pins().some((p) => check(p.key)); } catch { return false; }
  }
  private sendDevices(note?: string): void {
    try { if (this.binding) this.send?.(devicesFrame(this.devices, this.config.floor, this.now(), note)); }
    catch { /* a damaged trust record: chat stays shut (trusted() is false) until it's fixed here */ }
  }
  /** A new device asking to be trusted, or a trusted device's signed change (see devices.ts). */
  private device(frame: Extract<CubbyRelayFrame, { t: 'cubby.device-request' | 'cubby.device' }>): void {
    if (Math.abs(this.now() - frame.at) > 60_000 || this.seen.has(frame.requestId) || this.seen.size >= MAX_SEEN) return;
    this.seen.set(frame.requestId, frame.at);
    let note: string | undefined;
    try {
      if (frame.t === 'cubby.device-request') {
        if (typeof frame.publicKey !== 'string' || typeof frame.label !== 'string' || frame.label.length > 80) return;
        note = ask(this.devices, { requestId: frame.requestId, key: frame.publicKey, label: frame.label }, this.now());
      } else {
        if (!['add', 'deny', 'revoke'].includes(frame.action) || typeof frame.target !== 'string' || frame.target.length > 200) return;
        if (!this.trusted((key) => verifyOwnerDevice(key, frame))) note = 'That change wasn’t signed by a device this computer trusts, so nothing changed.';
        else { const done = change(this.devices, frame.action, frame.target, this.now()); note = done.note ?? done.error; }
      }
    } catch { note = 'Couldn’t update this computer’s trusted devices. Nothing changed.'; }
    this.sendDevices(note);
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
      if (generation !== this.generation || !this.binding) return;
      const head = await (this.deps.head?.() ?? headOf(this.config.project, run));
      if (this.waking) {
        this.waking = false;
        const before = this.deps.snapshot ? undefined : loadSeen(this.config.state);
        const commits = await (this.deps.commits?.(before?.head, head) ?? commitsSince(this.config.project, before?.head, head, run));
        const wake = wakeSummary(before ?? this.deps.seen?.(), frame.agents, this.now(), commits);
        if (wake) frame.wake = wake;
      }
      if (!this.deps.snapshot) saveSeen(this.config.state, { at: this.now(), head, agents: frame.agents.map(({ id, tool, role, task, status }) => ({ id, tool, role, task, status })) });
      if (generation === this.generation && this.binding && Buffer.byteLength(JSON.stringify(frame)) <= 64 * 1024) this.send?.(frame);
      if (generation === this.generation) this.sendDevices();
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

/**
 * What the owner calls this computer: on a Mac its Sharing name without the owner's name in front
 * ("Jonathan’s Mac mini" is "Mac mini", so the cubby says "Runs on your Mac mini"), else its hostname.
 */
export function friendlyName(): string {
  if (process.platform === 'darwin') {
    try {
      const name = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim();
      const plain = name.replace(/^.{1,40}?['’]s\s+/u, '').trim();
      if (plain) return plain;
    } catch { /* fall back to the hostname */ }
  }
  return os.hostname().replace(/\.(local|localdomain)$/i, '');
}
