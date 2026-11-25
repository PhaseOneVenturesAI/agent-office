import test from 'node:test';
import assert from 'node:assert/strict';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { cubbyKey, relaySignature } from '../src/server/cubbies/wire.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
import type { CubbyNodeFrame } from '../src/shared/protocol/cubbies.js';

const config: LocalConfig = { floor: 'floor', project: '/repo', roots: ['/repo'], branches: new Map(), state: '/unused',
  computerId: 'computer', provider: 'claude', session: 'session', executable: 'claude', claudeHome: '/unused', fresh: false };
const now = 1_800_000_000_000;
const binding = { cubbyId: 'cubby', floorId: 'floor', ownerId: 'owner', connectionId: 'connection' };
const sign = (frame: any) => JSON.stringify({ ...frame, signature: relaySignature(cubbyKey('token'), frame) });
const ready = (extra = {}) => sign({ t: 'cubby.ready', ...binding, ...extra });
const chat = (extra = {}) => sign({ t: 'cubby.chat', ...binding, requestId: 'request', at: now, text: 'owner chat', ...extra });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t: any, custom?: (text: string, signal: AbortSignal) => Promise<string>) {
  const sent: CubbyNodeFrame[] = [], received: string[] = [];
  let releases = 0, stops = 0;
  const connector = new CubbyConnector(config, 'token', {
    now: () => now, release: () => { releases++; },
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents: [], plan: [], needsYou: [], observedAt: now }),
    lead: { busy: false, send: async (text, signal) => { received.push(text); return custom ? custom(text, signal) : 'assistant reply'; }, stop: async () => { stops++; } },
  });
  connector.connected((frame) => sent.push(frame));
  t.after(() => connector.close());
  return { connector, sent, received, releases: () => releases, stops: () => stops };
}

test('signed ready gates chat; bad signatures, bindings, age and remote command/option frames never reach native lead', async (t) => {
  const f = fixture(t);
  assert.equal(f.sent[0].t, 'cubby.hello');
  f.connector.receive(chat());
  f.connector.receive(ready({ signature: 'bad', floorId: 'other' }));
  f.connector.receive(JSON.stringify({ t: 'cubby.ready', ...binding, signature: '0'.repeat(64) }));
  f.connector.receive(chat());
  assert.equal(f.received.length, 0);
  f.connector.receive(ready());
  for (const changes of [{ floorId: 'other' }, { ownerId: 'other' }, { cubbyId: 'other' }, { connectionId: 'other' },
    { at: now - 60_001 }, { at: now + 60_001 }, { at: null }, { requestId: '../escape' }, { text: '' }, { text: 'x'.repeat(8001) },
    { command: 'touch stolen' }, { path: '/elsewhere' }, { provider: 'codex' }, { t: 'cubby.shell' }, { t: 'cubby.file' }]) f.connector.receive(chat(changes));
  f.connector.receive('null'); f.connector.receive('{');
  assert.equal(f.received.length, 0);
  f.connector.receive(chat());
  await tick();
  assert.deepEqual(f.received, ['owner chat']);
  assert.equal(f.sent.filter((frame) => frame.t === 'cubby.reply' && !frame.error).length, 1);
});

test('dedupe survives reconnect, old ready cannot rebind, and reconnect never launches queued work', async (t) => {
  const f = fixture(t);
  f.connector.receive(ready()); f.connector.receive(chat()); await tick();
  f.connector.disconnected(); f.connector.connected((frame) => f.sent.push(frame));
  f.connector.receive(ready()); f.connector.receive(chat({ requestId: 'old-unseen' }));
  assert.equal(f.received.length, 1);
  f.connector.receive(ready({ connectionId: 'new' }));
  f.connector.receive(chat({ connectionId: 'new' }));
  await tick(); assert.equal(f.received.length, 1);
  f.connector.receive(chat({ connectionId: 'new', requestId: 'fresh' }));
  await tick(); assert.equal(f.received.length, 2);
});

test('disconnect aborts owned turn immediately and discards late replies/snapshots; busy messages are not queued', async (t) => {
  let resolve!: (value: string) => void, signal!: AbortSignal;
  const f = fixture(t, async (_text, s) => { signal = s; return new Promise((r) => { resolve = r; }); });
  f.connector.receive(ready()); f.connector.receive(chat());
  f.connector.receive(chat({ requestId: 'busy' }));
  assert.equal(f.received.length, 1);
  const before = f.sent.length;
  f.connector.disconnected(); assert.equal(signal.aborted, true);
  resolve('late sensitive reply'); await tick();
  assert.equal(f.sent.length, before);
  f.connector.connected((frame) => f.sent.push(frame)); f.connector.receive(ready({ connectionId: 'next' }));
  await tick(); assert.equal(f.received.length, 1);
});

test('wrong token and mutated signed text cannot run, even after ready', async (t) => {
  const f = fixture(t); f.connector.receive(ready());
  const frame = JSON.parse(chat()); frame.text = 'tampered'; f.connector.receive(JSON.stringify(frame));
  frame.signature = relaySignature(cubbyKey('other token'), frame); f.connector.receive(JSON.stringify(frame));
  await tick(); assert.equal(f.received.length, 0);
});


test('valid multibyte owner text fits the wire; expired signed text receives a visible error without running', async t => {
  const f = fixture(t); f.connector.receive(ready());
  f.connector.receive(chat({ requestId: 'expired', at: now - 61_000 })); await tick();
  assert.equal(f.received.length, 0);
  assert.ok(f.sent.some(frame => frame.t === 'cubby.reply' && frame.requestId === 'expired' && frame.error));
  const text = '字'.repeat(8000);
  f.connector.receive(chat({ requestId: 'multibyte', text })); await tick();
  assert.equal(f.received.length, 1); assert.equal(f.received[0]?.length, text.length);
});
