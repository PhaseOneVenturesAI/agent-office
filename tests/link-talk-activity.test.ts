import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startActivity, cleanActivity } from '../src/server/link/activity.js';
import { LeadTalk } from '../src/server/link/talk.js';
import { fixture, frame, record, session, flush } from './support/link-talk.js';

function post(port: number, token: string, data: string, overrides: Record<string, string> = {}, chunked = false) {
  return new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/activity', method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...overrides,
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject);
    if (chunked) { req.write(data.slice(0, 100)); req.write(data.slice(100)); req.end(); } else req.end(data);
  });
}

test('activity authenticates, guards host, caps bodies, strips extra fields and removes its private capability file', async t => {
  const f = fixture(t), server = await startActivity(f.stateDirectory);
  t.after(() => server.close());
  const file = path.join(f.stateDirectory, 'office-link.json'), link = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(link.schema, 1); assert.equal(link.pid, process.pid); assert.match(link.token, /^[a-f0-9]{64}$/);
  const events: unknown[] = []; server.activity.on('activity', e => events.push(e));
  const data = JSON.stringify({ schema: 1, event: 'Stop', sessionId: session, secret: 'discard' });
  assert.equal(await post(link.port, '', data), 401);
  assert.equal(await post(link.port, link.token, data, { Host: 'evil.example' }), 403);
  assert.equal(await post(link.port, link.token, data, { 'Content-Type': 'text/plain' }), 404);
  assert.equal(await post(link.port, link.token, data), 204);
  assert.deepEqual(events, [{ schema: 1, event: 'Stop', sessionId: session }]);
  const oversized = JSON.stringify({ padding: 'x'.repeat(16384) });
  assert.equal(await post(link.port, link.token, oversized, { 'Content-Length': String(Buffer.byteLength(oversized)) }), 413);
  assert.equal(await post(link.port, link.token, oversized, {}, true), 413);
  assert.equal(await post(link.port, link.token, '{'), 404);
  assert.equal(cleanActivity({ schema: 1, event: 'Stop', sessionId: session, reply: {} }), undefined);
  await server.close(); assert.equal(existsSync(file), false);
});

test('activity close preserves a replacement link file', async t => {
  const f = fixture(t), server = await startActivity(f.stateDirectory), file = path.join(f.stateDirectory, 'office-link.json');
  writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'replacement' }));
  await server.close(); assert.equal(existsSync(file), true);
});

test('authenticated matching Stop forwards a reply once; mismatched turn and session never do', async t => {
  const f = fixture(t), server = await startActivity(f.stateDirectory), frames: any[] = [];
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', live: () => record(), inbox: async () => {} });
  server.activity.on('activity', talk.activity);
  t.after(async () => { await talk.close(); await server.close(); });
  const link = JSON.parse(readFileSync(path.join(f.stateDirectory, 'office-link.json'), 'utf8'));
  const message = frame(); talk.receive(message); await flush();
  const stop = { schema: 1, event: 'Stop', sessionId: session, turn: message.id, reply: 'pong' };
  await post(link.port, link.token, JSON.stringify({ ...stop, turn: frame().id }));
  await post(link.port, link.token, JSON.stringify({ ...stop, sessionId: '22345678-1234-1234-1234-123456789abc' }));
  assert.equal(frames.filter(f => f.t === 'lead.reply').length, 0);
  await post(link.port, link.token, JSON.stringify(stop)); await post(link.port, link.token, JSON.stringify(stop));
  assert.deepEqual(frames.filter(f => f.t === 'lead.reply'), [{ t: 'lead.reply', id: message.id, text: 'pong' }]);
});
