import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WorkerApprovals } from '../src/server/approvals/service.js';
import { createApprovalHandlers } from '../src/server/approvals/handlers.js';
import { nativeRequest, nativeDecision } from '../src/server/approvals/native.js';
import { writeCodexHook } from '../src/server/codex.js';
import { writeApprovalHelper } from '../src/server/approvals/helper.js';
import { approvalHookRoute } from '../src/server/approvals/hook-route.js';
import { approvalAuthority } from '../src/server/ws/handlers/approvals.js';
import type { Worker } from '../src/server/workers/types.js';
const payload = (tool = 'Bash') => ({ session_id: 'session', turn_id: 'turn', tool_name: tool, tool_input: { command: 'npm test', description: 'Run focused tests' } });
function fixture(provider: 'claude' | 'codex' = 'claude') {
  const worker = { info: { id: 'worker', provider, sessionId: 'session', kind: 'agent', status: 'needs_input', owner: 'owner' }, hookToken: 'secret', pty: {} } as unknown as Worker;
  const workers = new Map([['worker', worker]]), approvals = new WorkerApprovals(workers);
  return { worker, workers, approvals, hold: () => approvals.hold(provider, 'worker', 'secret', payload(), () => true)! };
}
const until = async (check: () => boolean) => { const end = Date.now() + 3000; while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for fake provider'); await new Promise((r) => setTimeout(r, 10)); } };

test('native hooks retain overlapping invocation identity; stale or unoffered choices cannot answer the next request', async (t) => {
  const f = fixture(); t.after(() => f.approvals.close()); const first = f.hold(), id1 = f.approvals.state('worker').request!.id;
  const second = f.hold(); assert.equal(f.approvals.state('worker').queued, 2);
  assert.match(f.approvals.answer('worker', id1, 'allow_always') ?? '', /not offered/);
  assert.equal(f.approvals.answer('worker', id1, 'allow'), undefined); assert.deepEqual(await first.result, nativeDecision('allow'));
  const id2 = f.approvals.state('worker').request!.id; assert.notEqual(id1, id2);
  assert.match(f.approvals.answer('worker', id1, 'deny') ?? '', /no longer current/);
  assert.equal(f.approvals.answer('worker', id2, 'deny'), undefined); assert.deepEqual(await second.result, nativeDecision('deny'));
});

test('closed hook channel, changed session/run token and interruption invalidate choices without approval', async (t) => {
  const f = fixture('codex'); t.after(() => f.approvals.close());
  for (const change of [() => { f.worker.hookToken = 'new'; }, () => { f.worker.info.sessionId = 'new'; }, () => f.approvals.observe('worker', 'Interrupt')]) {
    f.worker.hookToken = 'secret'; f.worker.info.sessionId = 'session';
    const pending = f.hold(), id = f.approvals.state('worker').request!.id; change();
    assert.match(f.approvals.answer('worker', id, 'allow') ?? '', /no longer current/); assert.deepEqual(await pending.result, {});
  }
  f.worker.hookToken = 'secret'; f.worker.info.sessionId = 'session';
  const pending = f.hold(), id = f.approvals.state('worker').request!.id; pending.cancel();
  assert.match(f.approvals.answer('worker', id, 'allow') ?? '', /no longer current/); assert.deepEqual(await pending.result, {});
});

test('terminal fallback returns no native decision; malformed and interactive requests are never offered as approval buttons', async (t) => {
  const f = fixture(); t.after(() => f.approvals.close()); const pending = f.hold();
  assert.equal(f.approvals.terminal('worker', f.approvals.state('worker').request!.id), undefined); assert.deepEqual(await pending.result, {});
  for (const p of [{}, { ...payload(), agent_id: 'subagent' }, payload('AskUserQuestion'), payload('ExitPlanMode'), { ...payload(), tool_input: { command: 'x'.repeat(20001) } }]) assert.equal(nativeRequest('claude', p, 'invocation'), undefined);
  assert.equal(nativeRequest('codex', { ...payload(), turn_id: undefined }, 'invocation'), undefined);
  const request = nativeRequest('codex', payload(), 'invocation')!;
  assert.equal(request.source, 'permission-hook'); assert.equal(request.nativeRequestId, undefined);
  assert.deepEqual(request.options.map((o) => o.id), ['allow', 'deny']);
});

test('wrong owners and revoked department controllers cannot view or answer; revocation clears an unchanged subscribed request', async (t) => {
  const f = fixture(); t.after(() => f.approvals.close()); const pending = f.hold();
  const rights = new Set(['owner', 'controller']), sent: any[] = [], warnings: string[] = [];
  const floor = { workers: { approvals: f.approvals } };
  const ctx = { stillIn: () => true, workerFloor: () => floor, floorOf: () => floor, warn: (_c: unknown, s: string) => warnings.push(s), sendTo: (_c: unknown, msg: unknown) => sent.push(msg) } as any;
  const feature = createApprovalHandlers((_ctx, c) => rights.has(c.accountId!));
  const stranger = { accountId: 'other' } as any, controller = { accountId: 'controller' } as any;
  feature.handlers['approval.open'](ctx, stranger, { t: 'approval.open', workerId: 'worker' }); assert.equal(sent.length, 0); assert.equal(warnings.length, 1);
  feature.handlers['approval.open'](ctx, controller, { t: 'approval.open', workerId: 'worker' }); assert.ok(sent[0].state.request);
  const requestId = sent[0].state.request.id; rights.delete('controller');
  feature.handlers['approval.answer'](ctx, controller, { t: 'approval.answer', workerId: 'worker', requestId, optionId: 'allow' });
  assert.match(sent.at(-1).error, /access changed/); assert.equal(f.approvals.state('worker').queued, 1);
  await until(() => sent.some((m) => m.t === 'approval.state' && m.state.fallback?.includes('access changed')));
  assert.equal(f.approvals.state('worker').queued, 1); pending.cancel(); assert.deepEqual(await pending.result, {});
});

test('actual role policy requires both role authority and credential custody, never a generic admin bypass', () => {
  const worker = { provider: 'claude' }, lead = { controllers: ['controller@example.test'], custodian: 'custodian@example.test' };
  let owner = 'custodian';
  const floor = { isRoleWorker: () => true, ceo: { get: () => ({ owner: 'ceo@example.test', workerId: 'ceo-worker' }) }, departments: { leadDeptOfWorker: () => ({ name: 'Development', lead }) }, workers: { get: () => worker, ownerOf: () => owner } };
  const ctx = { workerFloor: () => floor, accounts: { any: true, get: (id: string) => ({ email: `${id}@example.test` }) }, signins: { officeRevoked: () => false }, meOf: () => ({ admin: true }) } as any;
  assert.equal(approvalAuthority(ctx, { accountId: 'admin' } as any, 'worker'), false);
  assert.equal(approvalAuthority(ctx, { accountId: 'controller' } as any, 'worker'), false, 'controller metadata alone is not a sharing grant');
  owner = 'controller'; assert.equal(approvalAuthority(ctx, { accountId: 'controller' } as any, 'worker'), true);
  lead.controllers = []; assert.equal(approvalAuthority(ctx, { accountId: 'controller' } as any, 'worker'), false);
  owner = 'ceo'; assert.equal(approvalAuthority(ctx, { accountId: 'ceo' } as any, 'ceo-worker'), true);
  ctx.signins.officeRevoked = () => true; assert.equal(approvalAuthority(ctx, { accountId: 'ceo' } as any, 'ceo-worker'), false);
});

for (const provider of ['claude', 'codex'] as const) test(`${provider} real generated hook helper returns native structured choice only for its live HTTP invocation`, async (t) => {
  const f = fixture(provider); t.after(() => f.approvals.close());
  const dir = mkdtempSync(path.join(tmpdir(), 'office-approval-helper-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const helper = provider === 'codex' ? writeCodexHook(dir) : writeApprovalHelper(dir);
  const ctx = { workerFloor: () => ({ workers: { approvals: f.approvals, handleProviderHook: (route: string, id: string, token: string) => route === provider && id === 'worker' && token === 'secret' } }) } as any;
  const server = http.createServer((req, res) => { void approvalHookRoute(ctx, req, res, new URL(req.url!, 'http://localhost')); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as any).port;
  const child = spawn(process.execPath, [helper, provider === 'codex' ? 'PermissionRequest' : provider], { env: { PATH: process.env.PATH, AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${port}`, AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_HOOK_TOKEN: 'secret' }, stdio: ['pipe','pipe','pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = ''; child.stdout.on('data', (c) => { output += c; });
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
  child.stdin.end(JSON.stringify(payload())); await until(() => !!f.approvals.state('worker').request);
  assert.equal(output, ''); const request = f.approvals.state('worker').request!;
  assert.equal(f.approvals.answer('worker', request.id, 'allow'), undefined);
  assert.equal(await exit, 0); assert.deepEqual(JSON.parse(output), nativeDecision('allow'));
});
