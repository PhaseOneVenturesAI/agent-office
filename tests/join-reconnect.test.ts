import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { generate } from 'selfsigned';
import { handshakeFailure } from '../src/server/join-access.js';

const nodeToken = 'fixture-node-secret';
const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.fixture-access-secret`;
const certificates = generate([{ name: 'commonName', value: 'localhost' }], {
  keyType: 'ec', algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', digitalSignature: true, keyCertSign: true },
    { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
  ],
});

/** Exercise the real join command and Access subprocess adapter without a real cache or account. */
async function fixture(t: TestContext, onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, ws: WebSocketServer) => void) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'office-join-'));
  const pems = await certificates;
  const ca = path.join(dir, 'ca.pem');
  const calls = path.join(dir, 'cache-reads.jsonl');
  await writeFile(ca, pems.cert);
  await writeFile(path.join(dir, 'cloudflared'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.JOIN_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write(process.env.JOIN_TEST_ACCESS);
`, { mode: 0o700 });
  const server = https.createServer({ key: pems.private, cert: pems.cert });
  const ws = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => onUpgrade(req, socket, head, ws));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = { ...process.env, HOME: dir, PATH: `${dir}${path.delimiter}${process.env.PATH}`, NODE_EXTRA_CA_CERTS: ca,
    AGENT_OFFICE_NODE_TOKEN: nodeToken, JOIN_TEST_ACCESS: accessToken, JOIN_TEST_CALLS: calls,
    JOIN_TEST_ARGS: JSON.stringify([url, '--cloudflare-access', '--name', 'test satellite']) };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `
    import { joinCommand } from './src/server/join.ts';
    process.exitCode = await joinCommand(JSON.parse(process.env.JOIN_TEST_ARGS));
    console.log('join-result', process.exitCode, 'sigint-listeners', process.listenerCount('SIGINT'));
  `], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const changed = new Set<() => void>();
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; for (const fn of changed) fn(); });
  const exited = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    await rm(dir, { recursive: true, force: true });
  });
  return {
    child, url,
    async line(pattern: RegExp) {
      if (pattern.test(output)) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { changed.delete(check); reject(new Error(`Missing output: ${pattern}`)); }, 5000);
        const check = () => { if (pattern.test(output)) { clearTimeout(timer); changed.delete(check); resolve(); } };
        changed.add(check); check();
      });
    },
    async result(code: number) {
      const [actual, signal] = await exited;
      assert.equal(signal, null, 'join must finish normally, not by signal/default handler');
      assert.equal(actual, code);
      assert.match(output, new RegExp(`join-result ${code} sigint-listeners 0`));
      assert.ok(!output.includes(nodeToken), 'node credential must stay out of logs');
      assert.ok(!output.includes(accessToken), 'Access credential must stay out of logs');
      const reads = (await readFile(calls, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(reads, [['access', 'token', '--app', url]], 'retries must reuse one cached credential');
      return output;
    },
  };
}

function reject(socket: Duplex, status: number, location?: string) {
  // Deliberately sensitive response content must never appear in client diagnostics.
  const body = `${nodeToken} ${accessToken}`;
  socket.end(`HTTP/1.1 ${status} Fixture\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${location ? `Location: ${location}\r\n` : ''}\r\n${body}`);
}

test('handshake retries are limited to transient origin failures; auth/redirects and permanent errors stop', () => {
  for (const status of [500, 502, 503, 504, 520, 521, 522, 523, 524]) assert.equal(handshakeFailure(status), 'retry');
  for (const status of [401, 403]) assert.equal(handshakeFailure(status), 'auth');
  for (const status of [301, 302, 303, 307, 308]) assert.equal(handshakeFailure(status), 'redirect');
  for (const status of [0, 200, 400, 404, 429, 501, 505, 525, 526]) assert.equal(handshakeFailure(status), 'reject');
});

test('join survives a restart and HTTP 503 with unchanged cached credentials and one backoff per attempt', { timeout: 15_000 }, async (t) => {
  let attempts = 0, hellos = 0;
  const seen: IncomingMessage[] = [];
  const f = await fixture(t, (req, socket, head, ws) => {
    seen.push(req);
    const attempt = ++attempts;
    if (attempt === 2) return reject(socket, 503);
    ws.handleUpgrade(req, socket, head, (connection) => {
      connection.once('message', (raw) => {
        assert.equal(JSON.parse(raw.toString()).t, 'hello'); hellos++;
        connection.close(attempt === 1 ? 1001 : 1000, 'fixture restart');
      });
    });
  });
  const output = await f.result(0);
  assert.equal(attempts, 3); assert.equal(hellos, 2);
  assert.deepEqual([...output.matchAll(/reconnecting in (\d+)s/g)].map((match) => match[1]), ['1', '2']);
  assert.equal((output.match(/connection dropped/g) ?? []).length, 1);
  assert.equal((output.match(/temporarily unavailable \(HTTP 503\)/g) ?? []).length, 1);
  assert.doesNotMatch(output, /expired|authorization rejected|couldn't reach/);
  for (const req of seen) {
    assert.equal(req.url, '/ws/node');
    assert.equal(req.headers.authorization, `Bearer ${nodeToken}`);
    assert.equal(req.headers['cf-access-token'], accessToken);
  }
});

test('a handshake network error followed by close schedules one retry', { timeout: 10_000 }, async (t) => {
  let attempts = 0;
  const f = await fixture(t, (req, socket, head, ws) => {
    if (++attempts === 1) return socket.destroy();
    ws.handleUpgrade(req, socket, head, (connection) => connection.close(1000));
  });
  const output = await f.result(0);
  assert.equal(attempts, 2);
  assert.equal((output.match(/reconnecting in/g) ?? []).length, 1);
  assert.equal((output.match(/couldn't reach/g) ?? []).length, 1);
  assert.doesNotMatch(output, /connection dropped/);
});

for (const status of [401, 403, 302, 501]) test(`HTTP ${status} stops join without retries, credential disclosure or redirect forwarding`, { timeout: 10_000 }, async (t) => {
  let attempts = 0;
  const f = await fixture(t, (req, socket) => {
    attempts++;
    reject(socket, status, `https://${req.headers.host}/redirect-secret`);
  });
  const output = await f.result(1);
  assert.equal(attempts, 1);
  assert.match(output, new RegExp(`HTTP ${status}`));
  assert.doesNotMatch(output, /reconnecting|redirect-secret|connection dropped|couldn't reach|expired/);
});

test('Ctrl-C interrupts backoff and cleans up without another handshake', { timeout: 10_000 }, async (t) => {
  let attempts = 0;
  const f = await fixture(t, (_req, socket) => { attempts++; reject(socket, 502); });
  await f.line(/reconnecting in 1s/);
  f.child.kill('SIGINT');
  const started = Date.now();
  await f.result(0);
  assert.ok(Date.now() - started < 900, 'must not wait for the one-second reconnect delay');
  assert.equal(attempts, 1);
});

test('Ctrl-C during an open connection settles once and clears its timers', { timeout: 10_000 }, async (t) => {
  let attempts = 0;
  const f = await fixture(t, (req, socket, head, ws) => {
    attempts++; ws.handleUpgrade(req, socket, head, () => {});
  });
  await f.line(/joined —/);
  f.child.kill('SIGINT');
  const output = await f.result(0);
  assert.equal(attempts, 1);
  assert.equal((output.match(/closed/g) ?? []).length, 1);
  assert.doesNotMatch(output, /reconnecting|connection dropped|couldn't reach/);
});

test('Ctrl-C during a pending handshake settles once without a timeout retry', { timeout: 10_000 }, async (t) => {
  let reached!: () => void;
  const pending = new Promise<void>((resolve) => { reached = resolve; });
  let attempts = 0;
  const f = await fixture(t, (_req, socket) => {
    attempts++; reached();
    // Hold the response until the client cancels, then release the fixture's socket.
    socket.on('end', () => socket.end());
  });
  await pending;
  f.child.kill('SIGINT');
  const output = await f.result(0);
  assert.equal(attempts, 1);
  assert.equal((output.match(/closed/g) ?? []).length, 1);
  assert.doesNotMatch(output, /reconnecting|connection dropped|couldn't reach/);
});
