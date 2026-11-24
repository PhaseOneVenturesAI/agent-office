import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { qualifyJob } from '../src/server/claude-qa/policy.js';
import { validateRequest, validateResponse } from '../src/server/claude-qa/protocol.js';
import { createClaudeQaBroker } from '../src/server/claude-qa/broker.js';
import { unitProperties } from '../src/server/claude-qa/runtime.js';
import { makeJob, requestBody, responseBody } from './fixtures/claude-qa-data.js';

test('policy evidence is fresh, account-bound, and unknown requirements fail before inference', () => {
  const job = makeJob(); assert.equal(qualifyJob(job).settings.channelsEnabled, false);
  for (const change of [
    (j: any) => { j.policy.accountId = 'other'; }, (j: any) => { j.policy.fetchedAt -= 60001; },
    (j: any) => { j.policy.fetchedAt += 10000; }, (j: any) => { j.policy.source = 'cached'; },
    (j: any) => { j.policy.settings.hooks = {}; }, (j: any) => { j.policy.settings.forceRemoteSettingsRefresh = true; },
    (j: any) => { j.policy.limits.requiredUnknown = true; }, (j: any) => { j.model = 'other-model'; },
  ]) { const j = makeJob(); change(j); assert.throws(() => qualifyJob(j)); }
});
test('request whitelist rejects tools, alternate models, extra contexts, capabilities and output overruns', () => {
  const job = makeJob(); validateRequest(Buffer.from(JSON.stringify(requestBody(job))), job);
  for (const change of [
    (b: any) => { b.tools = [{ name: 'Bash' }]; }, (b: any) => { b.model = 'other'; },
    (b: any) => { b.mcp_servers = []; }, (b: any) => { b.messages[0].content[0].text = 'other question'; },
    (b: any) => { b.system[0] = { type: 'image', source: { url: 'https://unapproved.invalid' } }; },
    (b: any) => { b.max_tokens = 32000; }, (b: any) => { b.messages.push(b.messages[0]); },
    (b: any) => { b.output_config = { effort: 'high', unknown: true }; },
  ]) { const b = requestBody(job); change(b); assert.throws(() => validateRequest(Buffer.from(JSON.stringify(b)), job)); }
  assert.throws(() => validateRequest(Buffer.alloc(256001), job));
});
test('response gate rejects forged tools, unknown events, missing completion and oversized output', () => {
  validateResponse(responseBody()); assert.throws(() => validateResponse(responseBody(true)));
  assert.throws(() => validateResponse(Buffer.from('event: unknown\ndata: {"type":"unknown"}\n\n')));
  assert.throws(() => validateResponse(responseBody().subarray(0, -60)));
  assert.throws(() => validateResponse(Buffer.alloc(1000001)));
  assert.throws(() => validateResponse(Buffer.from(responseBody().toString().replace('"index":0', '"index":7'))));
  assert.throws(() => validateResponse(Buffer.from(responseBody().toString().replace('event: message_start', 'event: ignored\nevent: message_start'))));
});
test('fixed runtime includes private network, unique user, no shell mounts and cgroup cleanup', () => {
  const p = unitProperties('/root/image', '/root/job', 'aabbccddeeff');
  for (const value of ['PrivateNetwork=yes', 'DynamicUser=yes', 'User=qa-aabbccddeeff', 'KillMode=control-group', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'ProtectProc=invisible']) assert.ok(p.includes(value));
  assert.throws(() => unitProperties('/root/image', '/root/job', '../../agent-office'));
  assert.throws(() => unitProperties('/root/image', '/root/job', 'aabbccddeeff', 10000));
  assert.ok(!p.some(x => x.includes('/home/agentoffice') || x.includes('docker.sock')));
});
function call(socket: string, capability: string, body: unknown, url = '/v1/messages?beta=true', extra: Record<string,string> = {}) {
  const raw = JSON.stringify(body);
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ socketPath: socket, method: 'POST', path: url, headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw), 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20', ...extra } }, res => {
      let text = ''; res.on('data', x => text += x); res.on('end', () => resolve({ status: res.statusCode!, text }));
    }); req.on('error', reject); req.end(raw);
  });
}
test('broker denies other routes and capabilities, substitutes token only upstream, and forwards one request', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-broker-')), socket = path.join(dir, 'b.sock'), job = makeJob(); let upstream = 0;
  const broker = await createClaudeQaBroker({ socket, job, accessToken: 'dummy-real-upstream-token', transport: async (body, headers) => { upstream++; assert.equal(headers.authorization, 'Bearer dummy-real-upstream-token'); assert.equal(JSON.parse(body.toString()).tools.length, 0); return { status: 200, body: responseBody() }; } });
  try {
    assert.equal((await call(socket, 'wrong', requestBody(job))).status, 403);
    assert.equal((await call(socket, 'é'.repeat(64), requestBody(job))).status, 403);
    for (const route of ['/api/claude_code/settings', '/v1/messages/count_tokens', '/v1/messages?model=other', 'https://unapproved.invalid/v1/messages']) assert.equal((await call(socket, broker.capability, requestBody(job), route)).status, 403);
    const result = await call(socket, broker.capability, requestBody(job)); assert.equal(result.status, 200); assert.ok(!result.text.includes('dummy-real-upstream-token'));
    assert.equal((await call(socket, broker.capability, requestBody(job))).status, 403); assert.equal(upstream, 1);
  } finally { await broker.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('concurrent native retries cannot spend a second inference and response timeouts fail closed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-broker-')), socket = path.join(dir, 'b.sock'), job = makeJob(); let upstream = 0;
  const broker = await createClaudeQaBroker({ socket, job, accessToken: 'dummy', timeoutMs: 100, transport: async (_body, _headers, signal) => {
    upstream++; await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })); throw new Error('unreachable');
  } });
  try {
    const results = await Promise.all([call(socket, broker.capability, requestBody(job)), call(socket, broker.capability, requestBody(job))]);
    assert.deepEqual(results.map(x => x.status).sort(), [403, 502]); assert.equal(upstream, 1); assert.equal(broker.metrics().accepted, 0);
    assert.equal((await call(socket, broker.capability, requestBody(job))).status, 403);
  } finally { await broker.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('unsupported policy starts no broker; malicious response never reaches native client', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-broker-')), socket = path.join(dir, 'b.sock'), job = makeJob();
  await assert.rejects(createClaudeQaBroker({ socket, job: { ...job, policy: { ...job.policy, settings: { hooks: {} } } }, accessToken: 'dummy' }));
  const broker = await createClaudeQaBroker({ socket, job, accessToken: 'dummy', transport: async () => ({ status: 200, body: responseBody(true) }) });
  try { const result = await call(socket, broker.capability, requestBody(job)); assert.equal(result.status, 502); assert.ok(!result.text.includes('touch /outside')); } finally { await broker.close(); rmSync(dir, { recursive: true, force: true }); }
});
