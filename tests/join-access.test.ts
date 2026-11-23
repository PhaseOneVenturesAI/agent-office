import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { accessHeaders, ACCESS_HELP, officeOrigin, nodeSocket } from '../src/server/join-access.js';
import { acceptWebSockets } from '../src/server/ws/upgrade.js';

const now = Date.now();
const jwt = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
async function listen(server: http.Server): Promise<string> {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `ws://127.0.0.1:${(server.address() as any).port}`;
}
const stop = (server: http.Server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });

test('Access adapter only reads the application cache; rejects missing/expired tokens without leaking subprocess output', async () => {
  const calls: string[][] = [];
  const token = jwt(Math.floor(now / 1000) + 300);
  const result = await accessHeaders('https://office.example', async (args) => { calls.push(args); return token; }, now);
  assert.deepEqual(calls, [['access', 'token', '--app', 'https://office.example']]);
  assert.equal(result.headers['CF-Access-Token'], token);
  for (const output of ['', 'bad token', jwt(Math.floor(now / 1000) - 1), 'secret\n' + token]) {
    await assert.rejects(accessHeaders('https://office.example', async () => output, now), (err: Error) => err.message === ACCESS_HELP && !err.message.includes(token));
  }
  await assert.rejects(accessHeaders('https://office.example', async () => { throw new Error('CF-Access-Token: SECRET'); }, now), { message: ACCESS_HELP });
  await assert.rejects(accessHeaders('http://office.example', async () => { assert.fail('must not invoke cloudflared'); }));
  assert.equal(officeOrigin('https://office.example/'), 'https://office.example');
  for (const input of ['https://user:secret@office.example', 'https://office.example/?token=secret', 'https://office.example/#secret', 'https://office.example/path']) assert.throws(() => officeOrigin(input));
});

test('the actual satellite handshake carries both credentials in headers and never follows redirects', async () => {
  let leaked = 0, request: http.IncomingMessage | undefined;
  const receiver = http.createServer((_req, res) => { leaked++; res.end(); });
  const receiverUrl = await listen(receiver);
  const server = http.createServer((_req, res) => { res.writeHead(302, { Location: receiverUrl.replace('ws:', 'http:') + '/captured' }); res.end(); });
  const url = await listen(server);
  server.on('request', (req) => { request = req; });
  const socket = nodeSocket(url, 'node-test-secret', { 'CF-Access-Token': 'access-test-secret' });
  try {
    await once(socket, 'error');
    assert.equal(leaked, 0);
    assert.equal(request?.url, '/ws/node');
    assert.equal(request?.headers.authorization, 'Bearer node-test-secret');
    assert.equal(request?.headers['cf-access-token'], 'access-test-secret');
  } finally { socket.terminate(); await stop(server); await stop(receiver); }
});

test('node endpoint still requires its own invite; an Access header never grants Office execution/session access', async () => {
  let attached = 0;
  const server = http.createServer();
  const ctx: any = { cfg: { port: 0 }, auth: { fromRequest: () => undefined }, services: { lookup: () => undefined }, nodes: { known: (t: string) => t === 'right-node', attach: (socket: any) => { attached++; socket.close(1000); } } };
  acceptWebSockets(ctx, server);
  const url = await listen(server);
  const bad = nodeSocket(url, 'wrong-node', { 'CF-Access-Token': 'valid-looking-access' });
  try { await once(bad, 'error'); assert.equal(attached, 0); }
  finally { bad.terminate(); }
  const good = nodeSocket(url, 'right-node');
  try { await once(good, 'close'); assert.equal(attached, 1); }
  finally { good.terminate(); await stop(server); }
});
