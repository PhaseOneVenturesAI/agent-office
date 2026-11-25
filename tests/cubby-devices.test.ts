// Several trusted devices per cubby (Jonathan, 2026-11-25: every device he's signed in on can talk to his
// lead). The computer decides; a new device is added only by a trusted device's signature over that
// exact key (or by the owner on the computer), and a server can't add, swap or keep a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { change, fileStore, memoryStore, pinFile, pinOf, readPins, writePins, type DeviceStore } from '../src/server/cubbies/local/devices.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
import { cubbyKey, ownerDeviceCode, ownerFingerprint, relaySignature } from '../src/server/cubbies/wire.js';
import { devicesOf } from '../src/server/cubbies/snapshot.js';
import { MAX_OWNER_DEVICES, type CubbyNodeFrame } from '../src/shared/protocol/cubbies.js';
import { codeOfKey } from '../src/client/shared/cubby/keys.js';
import { owner, testOwnerKey } from './support/cubby-keys.js';

const now = 1_800_000_000_000;
const binding = { cubbyId: 'cubby', floorId: 'floor', computerId: 'computer', ownerId: 'owner', connectionId: 'connection' };
const transport = (frame: any) => JSON.stringify({ ...frame, signature: relaySignature(cubbyKey('token'), frame) });
const tick = () => new Promise((resolve) => setImmediate(resolve));
let n = 0;
const rid = () => `r${++n}`;

function fixture(t: { after(fn: () => Promise<void>): void }, store: DeviceStore = memoryStore([pinOf(owner.ownerKey, 'Mac', 1)])) {
  const sent: CubbyNodeFrame[] = [], delivered: string[] = [];
  const config: LocalConfig = { ownerKey: owner.ownerKey, floor: 'floor', computerId: 'computer', state: '/unused',
    project: '/repo', roots: ['/repo'], branches: new Map(), provider: 'claude', session: 'session', executable: 'claude', claudeHome: '/unused', fresh: false };
  const connector = new CubbyConnector(config, 'token', {
    now: () => now, release: () => {}, devices: store,
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents: [], plan: [], needsYou: [], observedAt: now }),
    lead: { busy: false, send: async (text) => { delivered.push(text); return 'reply'; }, stop: async () => {} },
  });
  connector.connected((frame) => sent.push(frame));
  connector.receive(transport({ t: 'cubby.ready', ...binding }));
  t.after(() => connector.close());
  const devices = () => sent.filter((m): m is Extract<CubbyNodeFrame, { t: 'cubby.devices' }> => m.t === 'cubby.devices').at(-1)!;
  const ask = (key: string, label = 'iPhone') => connector.receive(transport({ t: 'cubby.device-request', ...binding, requestId: rid(), at: now, publicKey: key, label }));
  const act = (by: ReturnType<typeof testOwnerKey>, action: 'add' | 'deny' | 'revoke', target: string, extra: Record<string, unknown> = {}) => {
    const f = { ...binding, requestId: rid(), at: now, action, target, ...extra };
    connector.receive(transport({ t: 'cubby.device', ...f, ownerSig: by.signDevice(f) }));
  };
  const chat = (by: ReturnType<typeof testOwnerKey>, text: string) => {
    const f = { t: 'cubby.chat', ...binding, requestId: rid(), at: now, text };
    connector.receive(transport({ ...f, ownerSig: by.sign(f) }));
  };
  return { connector, sent, delivered, devices, ask, act, chat, store };
}

test('a new device asks, a trusted device approves that exact key, and then the new device can talk', async (t) => {
  const f = fixture(t), phone = testOwnerKey();
  assert.deepEqual(f.devices().devices.map((d) => d.label), ['Mac']);
  f.chat(phone, 'before'); await tick();
  assert.deepEqual(f.delivered, [], 'not trusted yet');
  f.ask(phone.ownerKey);
  const asked = f.devices();
  assert.equal(asked.requests.length, 1);
  assert.equal(asked.requests[0].publicKey, phone.ownerKey);
  assert.match(asked.note!, new RegExp(ownerDeviceCode(phone.ownerKey)));
  // The approving browser works the code out from the key itself; it matches what the computer shows.
  assert.equal(await codeOfKey(phone.ownerKey), ownerDeviceCode(phone.ownerKey));
  assert.match(ownerDeviceCode(phone.ownerKey), /^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){3}$/);
  f.act(owner, 'add', phone.ownerKey);
  assert.deepEqual(f.devices().devices.map((d) => d.label), ['Mac', 'iPhone']);
  assert.deepEqual(f.devices().requests, []);
  assert.match(f.devices().note!, /iPhone can talk to your lead now/);
  f.chat(phone, 'from the phone'); await tick();
  assert.deepEqual(f.delivered, ['from the phone']);
  assert.ok(!JSON.stringify(f.devices().devices).includes(phone.ownerKey), 'the office is told fingerprints, never trusted keys');
});

test('a server can’t add a device: unsigned, self-signed, untrusted-signed or swapped approvals change nothing', async (t) => {
  const f = fixture(t), phone = testOwnerKey(), attacker = testOwnerKey();
  f.ask(phone.ownerKey); f.ask(attacker.ownerKey);
  f.act(phone, 'add', phone.ownerKey);
  f.act(attacker, 'add', attacker.ownerKey);
  const base = { ...binding, requestId: rid(), at: now, action: 'add', target: attacker.ownerKey };
  f.connector.receive(transport({ t: 'cubby.device', ...base, ownerSig: 'A'.repeat(86) }));
  // The owner signed an approval for the phone; the server swaps in its own key.
  const signedForPhone = { ...binding, requestId: rid(), at: now, action: 'add', target: phone.ownerKey };
  f.connector.receive(transport({ t: 'cubby.device', ...signedForPhone, target: attacker.ownerKey, ownerSig: owner.signDevice(signedForPhone as any) }));
  // A key nobody asked with can't be approved either.
  f.act(owner, 'add', testOwnerKey().ownerKey);
  assert.deepEqual(f.devices().devices.map((d) => d.label), ['Mac']);
  assert.equal(f.devices().requests.length, 2);
  f.chat(attacker, 'let me in'); await tick();
  assert.deepEqual(f.delivered, []);
});

test('signed device changes can’t be replayed or sent stale, and the last device can’t be removed', async (t) => {
  const f = fixture(t), phone = testOwnerKey();
  f.ask(phone.ownerKey);
  f.act(owner, 'add', phone.ownerKey, { at: now - 60_001 });
  assert.equal(f.devices().devices.length, 1, 'stale');
  f.act(owner, 'add', phone.ownerKey);
  assert.equal(f.devices().devices.length, 2);
  // The phone removes the Mac; the Mac's signature then stops counting.
  f.act(phone, 'revoke', ownerFingerprint(owner.ownerKey));
  assert.deepEqual(f.devices().devices.map((d) => d.label), ['iPhone']);
  f.chat(owner, 'from the removed Mac'); await tick();
  assert.deepEqual(f.delivered, []);
  f.act(phone, 'revoke', ownerFingerprint(phone.ownerKey));
  assert.deepEqual(f.devices().devices.map((d) => d.label), ['iPhone']);
  assert.match(f.devices().note!, /only device/);
});

test('a denied request goes away; at most eight devices are trusted', async (t) => {
  const f = fixture(t), phone = testOwnerKey();
  f.ask(phone.ownerKey); f.act(owner, 'deny', phone.ownerKey);
  assert.deepEqual(f.devices().requests, []);
  assert.equal(f.devices().devices.length, 1);
  const store = memoryStore(Array.from({ length: MAX_OWNER_DEVICES }, () => pinOf(testOwnerKey().ownerKey, 'Device', 1)));
  const extra = testOwnerKey();
  const g = fixture(t, store);
  g.ask(extra.ownerKey);
  assert.match(change(store, 'add', extra.ownerKey, now).error!, /at most 8/);
});

test('the files on the computer: the older one-key record still reads, the local command approves by code, all 0600', async (t) => {
  const state = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-devices-')));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  writeFileSync(pinFile(state, 'floor'), JSON.stringify({ floor: 'floor', ownerKey: owner.ownerKey }), { mode: 0o600 });
  assert.deepEqual(readPins(state, 'floor')!.map((p) => p.key), [owner.ownerKey]);
  const store = fileStore(state, 'floor', owner.ownerKey);
  const f = fixture(t, store), phone = testOwnerKey();
  f.ask(phone.ownerKey, 'Pixel');
  const waiting = store.waiting();
  assert.equal(waiting[0].code, ownerDeviceCode(phone.ownerKey));
  // `agent-office cubby devices approve <code>` does this on the computer.
  assert.match(change(store, 'add', waiting[0].key, now).note!, /Pixel/);
  assert.deepEqual(readPins(state, 'floor')!.map((p) => p.label), ['First device', 'Pixel']);
  assert.equal(statSync(pinFile(state, 'floor')).mode & 0o777, 0o600);
  f.chat(phone, 'hi'); await tick();
  assert.deepEqual(f.delivered, ['hi'], 'the running connector reads the change at once');
  writePins(state, 'floor', [pinOf(phone.ownerKey, 'Pixel', now)]);
  assert.ok(JSON.parse(readFileSync(pinFile(state, 'floor'), 'utf8')).devices[0].fingerprint.includes('-'));
});

test('the office keeps only bounded, plain device fields from the computer', () => {
  const phone = testOwnerKey();
  const ok = devicesOf({ devices: [{ fingerprint: 'a'.repeat(32), label: 'Mac\u0007', addedAt: 1, key: 'secret' }], requests: [{ requestId: 'r1', label: 'iPhone', publicKey: phone.ownerKey, at: now }], note: 'hi' }, now)!;
  assert.deepEqual(ok.devices, [{ fingerprint: 'a'.repeat(32), label: 'Mac', addedAt: 1 }]);
  assert.equal(ok.requests[0].publicKey, phone.ownerKey);
  for (const bad of [{ devices: [], requests: [] }, { devices: [{ fingerprint: 'x', addedAt: 1 }], requests: [] },
    { devices: Array(MAX_OWNER_DEVICES + 1).fill({ fingerprint: 'a'.repeat(32), addedAt: 1 }), requests: [] },
    { devices: [{ fingerprint: 'a'.repeat(32), addedAt: 1 }], requests: [{ requestId: 'r', publicKey: 'short', at: now }] }]) assert.equal(devicesOf(bad, now), undefined);
});

test('a device code is 80 bits of the key hash, so a swapped key can’t be searched to match it', async () => {
  const { deviceCode, normalizeDeviceCode } = await import('../src/shared/protocol/cubbies.js');
  // 0x00…: all zero bits; 0xff…: all ones; a known pattern checks the bit order across byte edges.
  assert.equal(deviceCode(new Uint8Array(32)), '0000 0000 0000 0000');
  assert.equal(deviceCode(new Uint8Array(32).fill(0xff)), 'ZZZZ ZZZZ ZZZZ ZZZZ');
  assert.equal(deviceCode(Uint8Array.from([0x08, 0x86, 0x42, 0x98, 0xe8, 0x4a, 0x96, 0xc6, 0xb9, 0xf0, ...new Array(22).fill(0)])), '1234 5678 9ABC DEFG');
  assert.equal(normalizeDeviceCode('1234-5678 9abc defg'), normalizeDeviceCode('1234 5678 9ABC DEFG'));
  assert.equal(normalizeDeviceCode('O0 Il'), '0011');
});
