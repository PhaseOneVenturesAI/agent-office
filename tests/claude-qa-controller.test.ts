import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { executeControllerJob, CONTROLLER_IMAGE, type WorkerInput } from '../src/server/claude-qa/controller-worker.js';
import { requestIsolatedClaudeQa } from '../src/server/claude-qa/client.js';
import { makeJob } from './fixtures/claude-qa-data.js';

const input = (): WorkerInput => ({ request: { v: 1, requestId: 'a'.repeat(32), custodianAccountId: 'b'.repeat(16), prompt: 'Approved question.' }, runtimeId: 'c'.repeat(12), selected: { accountId: 'b'.repeat(16), accessToken: 'sk-ant-oat01-' + 'DUMMY'.repeat(8), oauthAccount: { accountUuid: '11111111-1111-1111-1111-111111111111', organizationUuid: '22222222-2222-2222-2222-222222222222', subscriptionType: 'team', scopes: ['user:inference'], expiresAt: Date.now() + 3600_000 } } });
test('controller worker stays unavailable without qualified policy and never infers for mismatched or stale credentials', async () => {
  let calls = 0;
  const run = async () => { calls++; return { ok: true, answer: 'Never', metrics: { forwarded: true, accepted: 1, denied: 0 }, policyDigest: '' }; };
  assert.deepEqual(await executeControllerJob(input(), { run }), { ok: false, code: 'unavailable' });
  for (const mutate of [(x: WorkerInput) => { x.selected.accountId = 'd'.repeat(16); }, (x: WorkerInput) => { x.selected.oauthAccount.expiresAt = Date.now(); }, (x: WorkerInput) => { x.runtimeId = '../../agent-office'; }]) {
    const x = input(); mutate(x); assert.equal((await executeControllerJob(x, { run })).ok, false);
  }
  assert.equal(calls, 0);
});
test('qualified trusted injection preserves fixed image, model and root-generated cleanup ID', async () => {
  const x = input();
  const result = await executeControllerJob(x, {
    qualify: async selected => { assert.equal(selected.accessToken, x.selected.accessToken); return { ...makeJob().policy, accountId: x.selected.accountId }; },
    run: async options => {
      assert.equal(options.image, CONTROLLER_IMAGE); assert.equal(options.runtimeId, x.runtimeId); assert.notEqual(options.runtimeId, x.request.requestId);
      assert.equal(options.job.model, 'claude-sonnet-4-6'); assert.equal(options.runtimeSeconds, 100); assert.equal(options.accessToken, x.selected.accessToken);
      return { ok: true, answer: 'Approved answer.', metrics: { forwarded: true, accepted: 1, denied: 0 }, policyDigest: 'dummy' };
    },
  });
  assert.deepEqual(result, { ok: true, answer: 'Approved answer.' });
  let inferred = false;
  assert.equal((await executeControllerJob(x, { qualify: async () => makeJob().policy, run: async () => { inferred = true; throw new Error(); } })).ok, false);
  assert.equal(inferred, false);
});

test('app seam sends only approved account/question metadata and validates bounded response identity', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-client-')), socket = path.join(dir, 'c.sock'); let mode = 'answer';
  const server = createServer(conn => {
    let raw = Buffer.alloc(0);
    conn.on('data', chunk => {
      raw = Buffer.concat([raw, chunk]); if (raw.length < 4 || raw.length < raw.readUInt32BE() + 4) return;
      const request = JSON.parse(raw.subarray(4).toString());
      assert.deepEqual(Object.keys(request).sort(), ['custodianAccountId', 'prompt', 'requestId', 'v']);
      assert.ok(!raw.includes(Buffer.from('sk-ant-')));
      if (mode === 'hold') return;
      const body = Buffer.from(JSON.stringify({ v: 1, requestId: mode === 'wrong' ? 'wrong' : request.requestId, ok: true, answer: 'Safe answer.' }));
      const header = Buffer.alloc(4); header.writeUInt32BE(mode === 'large' ? 1_000_001 : body.length); conn.write(Buffer.concat([header, body]));
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  const connect = () => createConnection(socket);
  try {
    assert.deepEqual(await requestIsolatedClaudeQa({ custodianAccountId: 'a'.repeat(16), prompt: 'Approved.' }, connect), { ok: true, answer: 'Safe answer.' });
    for (const m of ['wrong', 'large']) { mode = m; assert.equal((await requestIsolatedClaudeQa({ custodianAccountId: 'a'.repeat(16), prompt: 'Approved.' }, connect)).ok, false); }
    mode = 'hold'; const abort = new AbortController(); const pending = requestIsolatedClaudeQa({ custodianAccountId: 'a'.repeat(16), prompt: 'Approved.', signal: abort.signal }, connect); abort.abort(); assert.equal((await pending).ok, false);
    assert.equal((await requestIsolatedClaudeQa({ custodianAccountId: '../other', prompt: 'Approved.' }, () => { throw new Error('Must not connect'); })).ok, false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});
