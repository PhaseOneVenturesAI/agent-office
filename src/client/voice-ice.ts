import type { Net } from './net';
import type { IssuerState, VoiceIceStatus } from './voice-diagnostics';

/** Scoped to voice peers. No polling while disconnected, no permanent relay password in storage. */
export class VoiceIce {
  private ice: RTCIceServer[] | undefined;
  private expiresAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: { id: string; done: () => void; promise: Promise<void>; timeout: ReturnType<typeof setTimeout> };
  private active = false;
  private retryAt = 0;
  private failures = 0;
  private requestState: IssuerState = 'not-requested';
  private serverReportedVersion?: string;
  constructor(private net: Net, private fallback: () => RTCIceServer[], private updated: (ice: RTCIceServer[]) => void, private now = Date.now) {
    net.onStatus((up) => { if (!up) this.stop(); });
    net.onMessage((msg) => {
      if (msg.t === 'welcome') this.serverReportedVersion = msg.version;
      if (msg.t !== 'voice.ice' || msg.requestId !== this.pending?.id) return;
      this.requestState = msg.error ? 'rejected' : 'received';
      this.failures = 0;
      this.ice = msg.error ? undefined : msg.ice;
      this.expiresAt = msg.expiresAt ?? 0;
      this.finish();
      if (!msg.error) this.updated(this.servers());
      if (this.active && this.expiresAt) this.schedule(Math.max(10_000, this.expiresAt - this.now() - 120_000));
    });
  }
  servers(): RTCIceServer[] {
    return this.ice && (!this.expiresAt || this.expiresAt > this.now()) ? this.ice : this.fallback();
  }
  diagnostics(): VoiceIceStatus {
    return { request: this.requestState, credentials: !this.ice ? 'unavailable' : !this.expiresAt ? 'not-expiring' : this.expiresAt > this.now() ? 'valid' : 'expired', serverReportedVersion: this.serverReportedVersion };
  }
  async ready() {
    this.active = true;
    if (this.pending) return this.pending.promise;
    if (!this.net.up || this.failures >= 3 || this.now() < this.retryAt || (this.ice && (!this.expiresAt || this.expiresAt - this.now() > 120_000))) return;
    this.retryAt = this.now() + 15_000;
    this.requestState = 'pending';
    const id = crypto.randomUUID();
    let done!: () => void;
    const promise = new Promise<void>((resolve) => { done = resolve; });
    const timeout = setTimeout(() => { this.requestState = 'timed-out'; this.finish(); this.failures++; if (this.active && this.failures < 3) this.schedule(15_000); }, 3000);
    this.pending = { id, done, promise, timeout };
    this.net.send({ t: 'voice.ice', requestId: id });
    return promise;
  }
  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.ready(); }, ms);
  }
  private finish() {
    if (!this.pending) return;
    clearTimeout(this.pending.timeout);
    this.pending.done();
    this.pending = undefined;
  }
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.finish();
    this.ice = undefined;
    this.expiresAt = 0;
    this.retryAt = 0;
    this.failures = 0;
    this.requestState = 'not-requested';
  }
}

/** Rotate allocations only on relay-selected calls; healthy direct calls keep their ICE session. */
export async function refreshPeerIce(pc: RTCPeerConnection, iceServers: RTCIceServer[]) {
  if (pc.connectionState === 'closed') return;
  try {
    pc.setConfiguration({ ...pc.getConfiguration(), iceServers });
    const stats = await pc.getStats();
    let pair: RTCStats | undefined;
    stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    const candidate = pair && stats.get((pair as RTCStats & { localCandidateId: string }).localCandidateId);
    if (candidate?.candidateType === 'relay' || pc.iceConnectionState === 'failed') pc.restartIce();
  } catch { /* Peer may close during credential refresh; the next connection gets fresh credentials. */ }
}
