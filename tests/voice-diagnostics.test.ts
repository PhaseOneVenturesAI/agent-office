import test from 'node:test';
import assert from 'node:assert/strict';
import { VoicePeerDiagnostics } from '../src/client/voice-diagnostics.js';
import { VoiceIce } from '../src/client/voice-ice.js';

const privateValue = 'private-user:private-password@192.168.1.42';
const issuer = { request: 'received', credentials: 'valid', serverReportedVersion: 'e9540fe' } as const;
function connection(report = new Map<string, any>()) {
  const handlers = new Map<string, (event: any) => void>();
  const pc: any = {
    connectionState: 'failed', iceConnectionState: 'failed', iceGatheringState: 'complete', signalingState: 'stable',
    addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
    getConfiguration: () => ({ iceServers: [{ urls: `turn:${privateValue}:3478`, username: privateValue, credential: privateValue }] }),
    getStats: async () => report,
  };
  return { pc, handlers, diagnostics: new VoicePeerDiagnostics(pc) };
}

test('configured TURN is not evidence of an allocated or selected relay', async () => {
  const f = connection();
  f.handlers.get('icecandidate')!({ candidate: { type: 'host', address: privateValue, candidate: privateValue } });
  const result = await f.diagnostics.snapshot(issuer);
  assert.deepEqual(result.relay, { configured: true, localCandidateObserved: false, selected: null });
  assert.deepEqual(result.localCandidateTypesObserved, ['host']);
  assert.equal(result.states.connection, 'failed');
  assert.equal(result.serverReportedVersion, 'e9540fe');
  assert.ok(!JSON.stringify(result).includes(privateValue));
});

test('snapshot whitelists stats and errors, with bounded fields and no browser identity/address payload', async () => {
  const f = connection(new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair', certificate: privateValue }],
    ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote', state: 'succeeded', extra: privateValue }],
    ['local', { type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tcp', address: privateValue, username: privateValue, url: privateValue }],
    ['remote', { type: 'remote-candidate', candidateType: 'srflx', address: privateValue }],
  ]));
  for (const code of [701, 701, -1, 1.5, NaN, privateValue, ...Array.from({ length: 50 }, (_, i) => 300 + i)]) {
    f.handlers.get('icecandidateerror')!({ errorCode: code, errorText: privateValue, url: privateValue });
  }
  const result = await f.diagnostics.snapshot({ ...issuer, ignoredSecret: privateValue } as any);
  assert.deepEqual(result.relay, { configured: true, localCandidateObserved: true, selected: true });
  assert.deepEqual(result.selectedPair, { state: 'succeeded', localType: 'relay', remoteType: 'srflx', protocol: 'udp', relayProtocol: 'tcp' });
  assert.equal(result.candidateErrorCodes.length, 8);
  assert.equal(result.candidateErrorCodes[0], 701);
  assert.ok(!JSON.stringify(result).includes(privateValue));
  f.pc.connectionState = privateValue;
  const invalid = await f.diagnostics.snapshot({ request: privateValue, credentials: privateValue, serverReportedVersion: privateValue } as any);
  assert.equal(invalid.states.connection, 'unknown');
  assert.equal(invalid.serverReportedVersion, undefined);
  assert.deepEqual(invalid.issuer, { request: 'unknown', credentials: 'unknown' });
});

test('stats failures and a stalled browser report do not block failure details', async t => {
  const f = connection();
  f.pc.getStats = async () => { throw new Error(privateValue); };
  assert.equal((await f.diagnostics.snapshot(issuer)).stats, 'unavailable');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.pc.getStats = () => new Promise(() => {});
  const pending = f.diagnostics.snapshot(issuer);
  t.mock.timers.tick(1000);
  const result = await pending;
  assert.equal(result.stats, 'timed-out');
  assert.equal(result.selectedPair, null);
});

test('issuer diagnostics distinguish pending, timeout, rejection, receipt and expiry without copying the response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let message: (msg: any) => void = () => {}; let now = 1000000;
  const sent: any[] = [];
  const net: any = { up: true, onStatus() {}, onMessage: (fn: typeof message) => { message = fn; }, send: (msg: any) => sent.push(msg) };
  const ice = new VoiceIce(net, () => [], () => {}, () => now);
  assert.equal(ice.diagnostics().request, 'not-requested');
  let pending = ice.ready();
  assert.equal(ice.diagnostics().request, 'pending');
  t.mock.timers.tick(3000); await pending;
  assert.equal(ice.diagnostics().request, 'timed-out');
  now += 15000; pending = ice.ready();
  message({ t: 'voice.ice', requestId: sent.at(-1).requestId, error: privateValue, ice: [] }); await pending;
  assert.equal(ice.diagnostics().request, 'rejected');
  now += 15000; pending = ice.ready();
  message({ t: 'welcome', version: 'e9540fe' });
  message({ t: 'voice.ice', requestId: sent.at(-1).requestId, ice: [{ urls: `turn:${privateValue}`, credential: privateValue }], expiresAt: now + 600000 }); await pending;
  assert.deepEqual(ice.diagnostics(), { request: 'received', credentials: 'valid', serverReportedVersion: 'e9540fe' });
  now += 600001;
  assert.equal(ice.diagnostics().credentials, 'expired');
  ice.stop();
  assert.equal(ice.diagnostics().request, 'not-requested');
  assert.equal(ice.diagnostics().credentials, 'unavailable');
  assert.ok(!JSON.stringify(ice.diagnostics()).includes(privateValue));
});
