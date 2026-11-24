/** Local, bounded WebRTC evidence. Never serialize browser reports or error objects directly. */
export type IssuerState = 'not-requested' | 'pending' | 'received' | 'rejected' | 'timed-out';
export interface VoiceIceStatus {
  request: IssuerState;
  credentials: 'unavailable' | 'valid' | 'expired' | 'not-expiring';
  serverReportedVersion?: string;
}

const candidateTypes = ['host', 'srflx', 'prflx', 'relay'] as const;
type CandidateType = typeof candidateTypes[number];
const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | 'unknown' => allowed.includes(value as T) ? value as T : 'unknown';
const candidateType = (value: unknown) => pick(value, candidateTypes);
const protocol = (value: unknown) => pick(value, ['udp', 'tcp', 'tls'] as const);
const version = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{7,40}|\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.-]{1,32})?)$/i.test(value) ? value : undefined;

export function relayConfigured(servers: RTCIceServer[]): boolean {
  return servers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(url => /^turns?:/i.test(url)));
}

/** One peer connection; sets are bounded regardless of retries or malformed browser events. */
export class VoicePeerDiagnostics {
  private types = new Set<CandidateType>();
  private errors = new Set<number>();
  constructor(private pc: RTCPeerConnection) {
    pc.addEventListener('icecandidate', e => this.observeCandidate(e.candidate?.type));
    pc.addEventListener('icecandidateerror', e => this.observeError(e.errorCode));
  }
  observeCandidate(value: unknown) {
    const type = candidateType(value);
    if (type !== 'unknown') this.types.add(type);
  }
  observeError(value: unknown) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 300 && value <= 799 && this.errors.size < 8) this.errors.add(value);
  }
  async snapshot(issuer: VoiceIceStatus) {
    const pc = this.pc;
    // Capture states at the failure, before an automatic retry changes them.
    const states = {
      connection: pick(pc.connectionState, ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'] as const),
      ice: pick(pc.iceConnectionState, ['new', 'checking', 'connected', 'completed', 'disconnected', 'failed', 'closed'] as const),
      gathering: pick(pc.iceGatheringState, ['new', 'gathering', 'complete'] as const),
      signaling: pick(pc.signalingState, ['stable', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer', 'closed'] as const),
    };
    const configured = relayConfigured(pc.getConfiguration().iceServers ?? []);
    let report: RTCStatsReport | undefined;
    let stats: 'available' | 'unavailable' | 'timed-out' = 'unavailable';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      report = await Promise.race([
        pc.getStats(),
        new Promise<undefined>(resolve => { timer = setTimeout(() => { stats = 'timed-out'; resolve(undefined); }, 1000); }),
      ]);
      if (report) stats = 'available';
    } catch { /* A closed connection may no longer expose stats. */ }
    finally { clearTimeout(timer); }
    let pair: RTCIceCandidatePairStats | undefined;
    report?.forEach(s => {
      if (s.type === 'local-candidate') this.observeCandidate(s.candidateType);
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = report?.get(s.selectedCandidatePairId);
    });
    // Some browsers omit transport.selectedCandidatePairId.
    if (!pair) report?.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    const local = pair && report?.get(pair.localCandidateId);
    const remote = pair && report?.get(pair.remoteCandidateId);
    return {
      schema: 1,
      capturedAt: new Date().toISOString(),
      // The existing welcome version describes the server, not a hash of this browser bundle.
      serverReportedVersion: version(issuer.serverReportedVersion),
      issuer: {
        request: pick(issuer.request, ['not-requested', 'pending', 'received', 'rejected', 'timed-out'] as const),
        credentials: pick(issuer.credentials, ['unavailable', 'valid', 'expired', 'not-expiring'] as const),
      },
      states,
      relay: { configured, localCandidateObserved: this.types.has('relay'), selected: pair ? local?.candidateType === 'relay' : null },
      localCandidateTypesObserved: candidateTypes.filter(t => this.types.has(t)),
      candidateErrorCodes: [...this.errors],
      stats,
      selectedPair: pair ? {
        state: pick(pair.state, ['frozen', 'waiting', 'in-progress', 'failed', 'succeeded'] as const),
        localType: candidateType(local?.candidateType), remoteType: candidateType(remote?.candidateType),
        protocol: protocol(local?.protocol), relayProtocol: protocol(local?.relayProtocol),
      } : null,
    };
  }
}

export type VoiceDiagnosticSnapshot = Awaited<ReturnType<VoicePeerDiagnostics['snapshot']>>;
