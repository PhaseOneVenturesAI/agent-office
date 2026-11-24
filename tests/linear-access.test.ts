import test from 'node:test';
import assert from 'node:assert/strict';
import { canControlLinear } from '../src/server/linear/access.js';
import type { LinearControlScope } from '../src/server/linear/service.js';

function fixture() {
  const departments: Record<string, any> = {
    marketing: { id: 'marketing', name: 'Marketing', lead: { controllers: ['marketing@example.test'] } },
    development: { id: 'development', name: 'Development', lead: { controllers: ['development@example.test'] } },
    vacant: { id: 'vacant', name: 'Unstaffed' },
  };
  const tasks = [{ id: 'dev-task', linear: { departmentId: 'development' } }, { id: 'unscoped-task', linear: {} }];
  const floor = { ceo: { get: () => ({ owner: 'ceo@example.test' }) }, departments: { get: (id: string) => departments[id] }, queue: { state: () => ({ tasks }) } };
  const ctx = { floors: new Map([['floor', floor]]), accounts: { any: true, get: (id: string) => id === 'missing' ? undefined : ({ email: `${id}@example.test` }) }, meOf: () => ({ admin: true }) } as any;
  return { ctx, departments };
}

test('Linear uses actual scoped manager controls; generic admins and unrelated departments remain denied', () => {
  const { ctx } = fixture();
  for (const action of ['create', 'edit', 'assign'] as const) {
    const scope: LinearControlScope = { floorId: 'floor', departmentId: 'development', action };
    assert.equal(canControlLinear(ctx, 'development', scope), true);
    assert.equal(canControlLinear(ctx, 'marketing', scope), false);
    assert.equal(canControlLinear(ctx, 'integration-owner', scope), false);
    assert.equal(canControlLinear(ctx, 'ceo', scope), true);
    assert.equal(canControlLinear(ctx, 'missing', scope), false);
  }
});

test('unscoped, unknown and unstaffed department work does not inherit admin bootstrap permissions', () => {
  const { ctx } = fixture();
  for (const departmentId of [undefined, 'unknown', 'vacant']) {
    const scope: LinearControlScope = { floorId: 'floor', departmentId, action: 'create' };
    assert.equal(canControlLinear(ctx, 'development', scope), false);
    assert.equal(canControlLinear(ctx, 'integration-owner', scope), false);
    assert.equal(canControlLinear(ctx, 'ceo', scope), true);
  }
  assert.equal(canControlLinear(ctx, 'ceo', { floorId: 'other-floor', action: 'create' }), false);
});

test('existing task department cannot be forged, and revoked manager controls are observed immediately', () => {
  const { ctx, departments } = fixture();
  const scope: LinearControlScope = { floorId: 'floor', taskId: 'dev-task', departmentId: 'development', action: 'assign' };
  assert.equal(canControlLinear(ctx, 'development', scope), true);
  assert.equal(canControlLinear(ctx, 'marketing', { ...scope, departmentId: 'marketing' }), false);
  assert.equal(canControlLinear(ctx, 'development', { ...scope, taskId: 'unscoped-task' }), false);
  departments.development.lead.controllers = [];
  assert.equal(canControlLinear(ctx, 'development', scope), false);
});
