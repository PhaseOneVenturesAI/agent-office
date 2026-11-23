import test from 'node:test';
import assert from 'node:assert/strict';
import { providerReadiness } from '../src/server/provider-readiness.js';
import { readinessHandlers } from '../src/server/ws/handlers/provider-readiness.js';

test('credential presence and selected model never assert service access or quota', () => {
  const r = providerReadiness('kimi', false, { status: 'ok', how: 'login' }, [{ kind: 'agent', provider: 'kimi', name: 'Lead', model: 'selected', usage: { model: 'reported' } } as any], 123);
  assert.equal(r.installed, false);
  assert.equal(r.auth, 'configured');
  assert.match(r.evidence, /not verified/);
  assert.equal(r.quota, 'unknown');
  assert.deepEqual(r.models, [{ worker: 'Lead', selected: 'selected', reported: 'reported' }]);
  assert.match(providerReadiness('claude', true, { status: 'ok', how: 'token' }, [], 1).evidence, /not verified/);
});

test('readiness requires a personal account and never queries other accounts', () => {
  let warned = false;
  readinessHandlers['readiness.get']({ warn: () => { warned = true; }, signins: { look: () => assert.fail('must not inspect sign-ins') } } as any, {} as any);
  assert.equal(warned, true);
});
