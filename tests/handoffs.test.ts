import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerHandoffs, savedHandoff } from '../src/server/workers/handoffs.js';
import { ownedWorker } from '../src/server/ws/handlers/worker-access.js';

function fixture() {
  const source: any = { info: { id: 's', kind: 'agent', name: 'Lead', status: 'done' }, owner: 'account', pty: {} };
  const target: any = { info: { id: 't', kind: 'agent', name: 'Worker', status: 'idle' }, owner: 'account', pty: {} };
  const workers = new Map([['s', source], ['t', target]]);
  const sent: string[] = [];
  let save = true, branch = 'main';
  const service = new WorkerHandoffs({ workers, cwd: (w: any) => `/work/${w.id}`, emit() {}, setStatus(w: any, status: string) { w.info.status = status; } } as any, (_id, prompt) => { sent.push(prompt); }, () => save, () => branch, (cwd) => cwd);
  const prepare = () => service.prepare('s', 't', { brief: 'Fix one bug', evidence: 'Focused test passes', next: 'Review diff' }, 'Jonathan');
  return { service, source, target, sent, prepare, failSave: () => { save = false; }, switchBranch: () => { branch = 'other'; } };
}

test('human reviews exact context; acknowledgement delivers once without moving credentials or source work', () => {
  const f = fixture(), h = f.prepare();
  assert.notEqual(typeof h, 'string'); if (typeof h === 'string') return;
  assert.equal(f.sent.length, 0);
  assert.match(h.prompt, /Source branch: main/);
  assert.equal(f.service.acknowledge('s', h.id, 'Jonathan'), undefined);
  assert.deepEqual(f.sent, [h.prompt]);
  assert.match(f.service.acknowledge('s', h.id, 'Jonathan')!, /no longer pending/);
  assert.equal(f.sent.length, 1);
  assert.equal(f.source.owner, 'account'); assert.equal(f.target.owner, 'account');
  assert.equal(f.source.info.handoff.state, 'acknowledged');
  assert.equal(savedHandoff(f.source.info.handoff)?.to, 't');
});

test('handoff refuses stale branch, busy recipient, permission prompt and failed persistence', () => {
  for (const mode of ['branch', 'busy', 'permission', 'disk'] as const) {
    const f = fixture(), h = f.prepare(); if (typeof h === 'string') assert.fail(h);
    if (mode === 'branch') f.switchBranch();
    if (mode === 'busy') f.target.info.status = 'working';
    if (mode === 'permission') f.target.info.status = 'needs_input';
    if (mode === 'disk') f.failSave();
    assert.equal(typeof f.service.acknowledge('s', h.id, 'Jonathan'), 'string');
    assert.equal(f.sent.length, 0);
    assert.equal(f.source.info.handoff.state, 'pending');
  }
});

test('cancel permits a new explicit preview and malformed persisted records are ignored', () => {
  const f = fixture(), h = f.prepare(); if (typeof h === 'string') assert.fail(h);
  assert.equal(f.service.cancel('s', h.id), undefined);
  assert.equal(typeof f.prepare(), 'object');
  assert.equal(f.sent.length, 0);
  assert.equal(savedHandoff({ id: 'forged', state: 'pending' }), undefined);
});

test('private worker features reject another account and another floor', () => {
  const floor: any = { workers: { ownerOf: () => 'owner', get: () => ({ id: 'w' }) } };
  let warned = 0;
  const ctx: any = { workerFloor: () => floor, floorOf: () => floor, meOf: () => ({ admin: true }), warn: () => warned++ };
  assert.equal(ownedWorker(ctx, { accountId: 'other' } as any, 'w'), undefined);
  ctx.floorOf = () => ({});
  assert.equal(ownedWorker(ctx, { accountId: 'owner' } as any, 'w'), undefined);
  assert.equal(warned, 2);
});

test('different path spellings cannot hand off between the same physical worktree', () => {
  const workers = new Map<string, any>([['s', { info: { id: 's', kind: 'agent', name: 'Lead' } }], ['t', { info: { id: 't', kind: 'agent', name: 'Worker' } }]]);
  const service = new WorkerHandoffs({ workers, cwd: (w: any) => `/alias/${w.id}` } as any, () => assert.fail('must not send'), () => true, () => 'main', () => '/same/physical/worktree');
  assert.match(String(service.prepare('s', 't', { brief: 'Bug fix', evidence: 'Unverified', next: 'Reproduce' }, 'Jonathan')), /separate physical worktrees/);
});

test('two reviewed sources cannot both deliver into the same idle recipient before a PTY hook arrives', () => {
  const workers = new Map<string, any>(['s1', 's2', 't'].map((id) => [id, { info: { id, name: id, kind: 'agent', status: 'done' }, pty: {} }]));
  let sent = 0;
  const service = new WorkerHandoffs({ workers, cwd: (w: any) => `/work/${w.id}`, emit() {}, setStatus(w: any, status: string) { w.info.status = status; } } as any, () => { sent++; }, () => true, () => 'main', (cwd) => cwd);
  const brief = { brief: 'Scoped task', evidence: 'Unverified', next: 'Review' };
  const first = service.prepare('s1', 't', brief, 'Jonathan'), second = service.prepare('s2', 't', brief, 'Jonathan');
  if (typeof first === 'string' || typeof second === 'string') assert.fail('both previews should be reviewable');
  assert.equal(service.acknowledge('s1', first.id, 'Jonathan'), undefined);
  assert.equal(workers.get('t').info.status, 'working');
  assert.match(service.acknowledge('s2', second.id, 'Jonathan')!, /idle or done/);
  assert.equal(sent, 1);
});
