import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { configure, persistSelection, type LocalConfig } from '../src/server/cubbies/local/config.js';
import { cubbyKey, ownerFingerprint, ownerPublicKey, relaySignature, verifyOwner } from '../src/server/cubbies/wire.js';
import { ownerChatEncoding, type CubbyNodeFrame } from '../src/shared/protocol/cubbies.js';
import { signOwnerChat } from '../src/client/features/cubbies/keys.js';
import { owner, testOwnerKey } from './support/cubby-keys.js';

const now = 1_800_000_000_000;
const binding = { cubbyId: 'cubby', floorId: 'floor', computerId: 'computer', ownerId: 'owner', connectionId: 'connection' };
const payload = { ...binding, text: '  owner chat\n字 🔑  ', requestId: 'request', at: now };
const transport = (frame: any) => JSON.stringify({ ...frame, signature: relaySignature(cubbyKey('token'), frame) });
const chat = (extra = {}) => { const f = { t: 'cubby.chat', ...payload, ...extra }; return { ...f, ownerSig: owner.sign(f) }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t: { after(fn: () => Promise<void>): void }) {
  const sent: CubbyNodeFrame[] = [], delivered: string[] = [];
  const config: LocalConfig = { ownerKey: owner.ownerKey, floor: 'floor', computerId: 'computer', state: '/unused',
    project: '/repo', roots: ['/repo'], branches: new Map(), provider: 'claude', session: 'session', executable: 'claude', claudeHome: '/unused', fresh: false };
  const connector = new CubbyConnector(config, 'token', {
    now: () => now, release: () => {},
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents: [], plan: [], needsYou: [], observedAt: now }),
    lead: { busy: false, send: async (text) => { delivered.push(text); return 'reply'; }, stop: async () => {} },
  });
  connector.connected((frame) => sent.push(frame));
  connector.receive(transport({ t: 'cubby.ready', ...binding }));
  t.after(() => connector.close());
  return { connector, sent, delivered };
}

test('pinned owner signature delivers exact text and reports only its public fingerprint', async (t) => {
  const f = fixture(t);
  f.connector.receive(transport(chat())); await tick();
  assert.deepEqual(f.delivered, [payload.text]);
  assert.ok(f.sent.some((m) => m.t === 'cubby.owner-key' && m.fingerprint === ownerFingerprint(owner.ownerKey)));
});

test('compromised relay with token/HMAC cannot mint owner chat or poison replay IDs', async (t) => {
  const f = fixture(t), other = testOwnerKey();
  for (const ownerSig of [undefined, null, '', 'bad', 'A'.repeat(86), other.sign(payload)]) {
    const frame = { ...chat(), ownerSig };
    f.connector.receive(transport(frame));
  }
  await tick(); assert.deepEqual(f.delivered, []);
  assert.equal(f.sent.filter((m) => m.t === 'cubby.reply' && m.error && m.text === "Message not signed by this cubby's owner key").length, 6);
  // A forged requestId must not consume the real owner's signed message.
  f.connector.receive(transport(chat())); await tick();
  assert.deepEqual(f.delivered, [payload.text]);
});

test('owner signature covers every canonical field despite a freshly valid transport HMAC', async (t) => {
  const signed = chat();
  for (const mutation of [{ cubbyId: 'other' }, { floorId: 'other' }, { computerId: 'other' },
    { requestId: 'other' }, { at: now + 1 }, { text: 'server prompt' }]) {
    const changed = { ...signed, ...mutation };
    assert.equal(verifyOwner(owner.ownerKey, changed), false);
    const f = fixture(t); f.connector.receive(transport(changed)); await tick();
    assert.deepEqual(f.delivered, []);
  }
  assert.equal(ownerChatEncoding(payload), JSON.stringify(['agent-office/cubby-owner-chat/v1', 'cubby', 'floor', 'computer', 'request', now, payload.text]));
});

test('signed replay, stale/future timestamps and cross-connection replay fail closed', async (t) => {
  const f = fixture(t);
  for (const at of [now - 60_001, now + 60_001]) f.connector.receive(transport(chat({ at })));
  assert.deepEqual(f.delivered, []);
  f.connector.receive(transport(chat())); await tick();
  f.connector.receive(transport(chat())); await tick();
  f.connector.disconnected(); f.connector.connected((frame) => f.sent.push(frame));
  f.connector.receive(transport({ t: 'cubby.ready', ...binding, connectionId: 'new' }));
  f.connector.receive(transport({ ...chat(), connectionId: 'new' })); await tick();
  assert.deepEqual(f.delivered, [payload.text]);
});

test('WebCrypto non-extractable P-256 browser signature interoperates with the local verifier', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  await assert.rejects(webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64url');
  const ownerSig = await signOwnerChat({ privateKey: pair.privateKey as CryptoKey, publicKey, fingerprint: ownerFingerprint(publicKey) }, payload);
  assert.equal(verifyOwner(publicKey, { ...payload, ownerSig }), true);
  assert.throws(() => ownerPublicKey(publicKey + '='), /owner-key/);
  const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  assert.throws(() => ownerPublicKey(wrongCurve), /owner-key/);
});

test('local join pins 0600 key, refuses a different key, and only local replacement can rotate it', async (t) => {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-owner-key-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo'); mkdirSync(path.join(project, '.git'), { recursive: true });
  const execute = async (_bin: string, args: string[]) => args.includes('--show-toplevel') ? project
    : args.includes('--git-common-dir') ? path.join(project, '.git') : `worktree ${project}\0branch refs/heads/main\0\0`;
  const options = { floor: 'floor', project, provider: 'claude', session: '12345678-1234-1234-1234-123456789abc' };
  await assert.rejects(configure(options, home, execute), /requires --owner-key/);
  await assert.rejects(configure({ ...options, ownerKey: 'bad' }, home, execute), /owner-key/);
  const initial = await configure({ ...options, ownerKey: owner.ownerKey }, home, execute);
  persistSelection(initial);
  const pin = path.join(initial.state, readdirSync(initial.state).find((file) => file.startsWith('owner-'))!);
  assert.equal(statSync(pin).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(pin, 'utf8')).ownerKey, owner.ownerKey);
  await configure({ ...options, ownerKey: owner.ownerKey }, home, execute);
  const other = testOwnerKey();
  await assert.rejects(configure({ ...options, ownerKey: other.ownerKey }, home, execute), /--replace-owner-key/);
  assert.throws(() => persistSelection({ ...initial, ownerKey: other.ownerKey }), /--replace-owner-key/, 'recheck under local project lock');
  assert.equal(JSON.parse(readFileSync(pin, 'utf8')).ownerKey, owner.ownerKey);
  const replacement = await configure({ ...options, ownerKey: other.ownerKey, replaceOwnerKey: true }, home, execute);
  persistSelection(replacement);
  assert.equal(JSON.parse(readFileSync(pin, 'utf8')).ownerKey, other.ownerKey);
  assert.equal(statSync(pin).mode & 0o777, 0o600);
  await assert.rejects(configure({ ...options, ownerKey: owner.ownerKey }, home, execute), /--replace-owner-key/);
});
