import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { checkAccess, readServiceToken, serviceTokenFile } from '../src/server/link/service-token.js';
import { cachedAccess, request } from '../src/server/link/transport.js';
import { nodeSocket } from '../src/server/join-access.js';
import { linkCommand } from '../src/server/link/cli.js';

const ID = 'fake-client-id.access', SECRET = 'fakesecret0123456789abcdef';
function home(t: any, mode?: number, body: unknown = { clientId: ID, clientSecret: SECRET }) {
  mkdirSync('.paradev', { recursive: true });
  const dir = mkdtempSync(path.resolve('.paradev/link-token-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (mode !== undefined) {
    const file = serviceTokenFile(dir); mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), { mode }); chmodSync(file, mode);
  }
  return dir;
}
async function server(t: any, onHeaders: (h: http.IncomingHttpHeaders) => void) {
  const s = http.createServer((req, res) => { onHeaders(req.headers); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
  s.on('upgrade', (req, sock) => { onHeaders(req.headers); sock.destroy(); });
  s.listen(0, '127.0.0.1'); await once(s, 'listening'); t.after(() => s.close());
  return `http://127.0.0.1:${(s.address() as any).port}`;
}

test('service token file: missing falls back, 0600 is read, wider modes, links and bad JSON are refused', t => {
  assert.equal(readServiceToken(home(t)), undefined);
  assert.deepEqual(readServiceToken(home(t, 0o600)), { clientId: ID, clientSecret: SECRET });
  for (const mode of [0o640, 0o644, 0o604]) assert.throws(() => readServiceToken(home(t, mode)), /readable by others; run `chmod 600/);
  assert.throws(() => readServiceToken(home(t, 0o600, '{')), /needs "clientId" and "clientSecret"/);
  assert.throws(() => readServiceToken(home(t, 0o600, { clientId: ID })), /needs/);
  const linked = home(t, 0o600), file = serviceTokenFile(linked);
  rmSync(file); symlinkSync(path.join(linked, 'elsewhere.json'), file);
  writeFileSync(path.join(linked, 'elsewhere.json'), JSON.stringify({ clientId: ID, clientSecret: SECRET }), { mode: 0o600 });
  assert.throws(() => readServiceToken(linked), /regular file/);
});

test('service token headers go on https link requests only and win over the cloudflared login', async t => {
  const dir = home(t, 0o600);
  assert.deepEqual(await cachedAccess('https://office.example', dir), { 'CF-Access-Client-Id': ID, 'CF-Access-Client-Secret': SECRET });
  assert.deepEqual(await cachedAccess('http://127.0.0.1:1', dir), {}, 'never sent to a plain-http office');
  await assert.rejects(cachedAccess('https://office.example', home(t, 0o644)), /chmod 600/);
});

test('the headers reach both the HTTP link requests and the /ws/node websocket upgrade', async t => {
  const seen: http.IncomingHttpHeaders[] = [], origin = await server(t, h => seen.push(h));
  const headers = { 'CF-Access-Client-Id': ID, 'CF-Access-Client-Secret': SECRET };
  await request(origin, '/api/mac-link/poll', {}, headers);
  const ws = nodeSocket(origin.replace(/^http/, 'ws'), 'ao_node_x', headers); ws.on('error', () => {});
  await once(ws, 'close').catch(() => {});
  assert.equal(seen.length, 2);
  for (const h of seen) { assert.equal(h['cf-access-client-id'], ID); assert.equal(h['cf-access-client-secret'], SECRET); }
});

test('check-access reports only OK or refused(status), never the credential', async t => {
  const fake = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;
  const dir = home(t, 0o600);
  assert.equal(await checkAccess(dir, 'https://office.example', fake(200)), 'service token OK');
  assert.equal(await checkAccess(dir, 'https://office.example', fake(302)), 'refused (302)');
  assert.equal(await checkAccess(dir, 'https://office.example', fake(403)), 'refused (403)');
  assert.equal(await checkAccess(dir, 'https://office.example', (async () => { throw Error(SECRET); }) as unknown as typeof fetch), 'refused (network error)');
  assert.equal(await checkAccess(home(t), 'https://office.example', fake(200)), 'refused (no service token file)');
  assert.match(await checkAccess(home(t, 0o644), 'https://office.example', fake(200)), /^refused \(.*chmod 600/);
});

test('link refuses an unsafe token file up front (78 under launchd) and never logs the secret', async t => {
  const logs: string[] = [], dir = home(t, 0o644);
  assert.equal(await linkCommand(['https://office.example', '--run'], dir, s => logs.push(s)), 78);
  assert.equal(await linkCommand(['https://office.example'], dir, s => logs.push(s)), 1);
  assert.equal(await linkCommand(['https://office.example', '--run', '--check-access'], dir, s => logs.push(s)), 2);
  assert.ok(logs.some(l => /chmod 600/.test(l)));
  assert.ok(logs.every(l => !l.includes(SECRET) && !l.includes(ID)));
});
