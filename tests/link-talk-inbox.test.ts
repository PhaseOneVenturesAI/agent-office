import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { sendInbox, markerFile, writeMarker, removeMarker } from '../src/server/link/inbox.js';
import { deliveredText } from '../src/shared/protocol/lead-talk.js';
import { fixture, frame, record, session } from './support/link-talk.js';

async function socketFixture(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t), dir = `/tmp/cc-socks-${randomInt(100000000, 999999999)}`;
  mkdirSync(dir, { mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const socket = path.join(dir, `${process.pid}.sock`), key = path.join(f.sessions, `${process.pid}.${'a'.repeat(64)}.key`);
  writeFileSync(key, JSON.stringify({ peerToken: 'b'.repeat(32) }), { mode: 0o600 });
  const lines: unknown[] = [], server = createServer(peer => {
    let text = ''; peer.on('data', chunk => {
      text += chunk; let end: number;
      while ((end = text.indexOf('\n')) >= 0) { lines.push(JSON.parse(text.slice(0, end))); text = text.slice(end + 1); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  return { ...f, socket, key, lines };
}
test('inbox writes auth then one deliveredText user turn and an owner-only marker', async t => {
  const f = await socketFixture(t), message = frame();
  writeMarker(f.stateDirectory, session, 'stale marker from a stopped link');
  writeMarker(f.stateDirectory, session, message.id);
  await sendInbox(f.home, { ...record(), messagingSocketPath: f.socket }, message, new AbortController().signal);
  assert.deepEqual(f.lines, [{ type: 'auth', token: 'b'.repeat(32) }, { type: 'user', message: { role: 'user', content: deliveredText(message) } }]);
  const marker = markerFile(f.stateDirectory, session);
  assert.equal(readFileSync(marker, 'utf8'), message.id);
  assert.equal(statSync(marker).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(marker)).mode & 0o777, 0o700);
  removeMarker(f.stateDirectory, session, 'another'); assert.equal(readFileSync(marker, 'utf8'), message.id);
  removeMarker(f.stateDirectory, session, message.id); assert.throws(() => statSync(marker));
});
test('inbox rejects paths outside cc-socks and unsafe key modes before sending', async t => {
  const f = await socketFixture(t), message = frame(), signal = new AbortController().signal;
  await assert.rejects(sendInbox(f.home, { ...record(), messagingSocketPath: path.join(f.home, 'bad.sock') }, message, signal), /not allowed/);
  chmodSync(f.key, 0o644);
  await assert.rejects(sendInbox(f.home, { ...record(), messagingSocketPath: f.socket }, message, signal), /unsafe permissions/);
  assert.deepEqual(f.lines, []);
});
