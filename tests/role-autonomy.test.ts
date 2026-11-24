import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedAutonomy, prepareAutonomy } from '../src/server/providers/autonomy.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('legacy informational role labels never enable automatic permission changes', () => {
  assert.equal(confirmedAutonomy({ autonomy: 'autonomous' }), undefined);
  assert.equal(confirmedAutonomy({ autonomy: 'autonomous', autonomyConfirmed: true }), 'autonomous');
});
test('verified CLI launch modes retain approvals and sandboxing without bypass flags', () => {
  for (const [provider, version, expected] of [
    ['claude', '2.1.330', ['--permission-mode', 'auto']],
    ['codex', '0.171.0-alpha.13', ['--sandbox', 'workspace-write', '--approve-for-me']],
    ['kimi', '2.7.2', []],
  ] as const) {
    const info = { provider, autonomyRequested: 'autonomous' } as WorkerInfo;
    const args: string[] = [];
    assert.equal(prepareAutonomy(info, '/fake/cli', args, () => version), undefined);
    assert.deepEqual(args, expected);
    assert.equal(!!info.autonomyApplied, provider !== 'kimi', 'ACP must acknowledge its mode before claiming applied');
  }
});
test('unknown CLI versions and conflicting bypass arguments fail closed', () => {
  const info = { provider: 'kimi', autonomyRequested: 'autonomous' } as WorkerInfo;
  assert.match(prepareAutonomy(info, '/fake', [], () => '2.7.3')!, /not verified/);
  assert.match(prepareAutonomy(info, '/fake', ['--auto'], () => '2.7.2')!, /conflicting/);
  assert.equal(info.autonomyApplied, undefined);
});

test('permission preference changes wait for restart and rollback on persistence failure', async () => {
  const { WorkerManager } = await import('../src/server/workers/manager.js');
  const info = { autonomyRequested: 'supervised', autonomyApplied: { mode: 'supervised', provider: 'kimi', detail: 'Kimi manual approvals' } } as WorkerInfo;
  const ctx = { workers: new Map([['w', { info }]]), persist: () => true, emitUpdate() {} };
  assert.equal(WorkerManager.prototype.queueAutonomy.call(ctx as never, 'w', 'autonomous'), undefined);
  assert.equal(info.autonomyRequested, 'autonomous');
  assert.equal(info.autonomyApplied?.mode, 'supervised');
  ctx.persist = () => false;
  assert.match(WorkerManager.prototype.queueAutonomy.call(ctx as never, 'w', 'off')!, /could not be saved/);
  assert.equal(info.autonomyRequested, 'autonomous');
});

 test('current inspected provider versions preserve automatic and supervised launch policies', () => {
  for (const [provider, version] of [['claude', '2.1.331'], ['codex', '0.171.0']] as const) {
    for (const mode of ['autonomous', 'supervised', 'off'] as const) {
      const info = { provider, autonomyRequested: mode } as WorkerInfo;
      const args: string[] = [];
      assert.equal(prepareAutonomy(info, '/fake/cli', args, () => version), undefined);
      assert.deepEqual(args, provider === 'claude'
        ? ['--permission-mode', mode === 'autonomous' ? 'auto' : 'manual']
        : mode === 'autonomous' ? ['--sandbox', 'workspace-write', '--approve-for-me']
        : ['--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
      assert.equal(info.autonomyApplied?.acknowledged, false);
    }
    const info = { provider, autonomyRequested: 'autonomous' } as WorkerInfo;
    assert.match(prepareAutonomy(info, '/fake', [], () => version + '-unverified')!, /not verified/);
    assert.match(prepareAutonomy(info, '/fake', ['--dangerously-bypass-approvals-and-sandbox'], () => version)!, /conflicting/);
  }
});
