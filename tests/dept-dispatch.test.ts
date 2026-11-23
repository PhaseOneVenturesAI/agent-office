// The orchestration dispatch (see src/server/dept-dispatch.ts): child transitions reach the
// manager, managers with a CEO objective roll up, held notices flush only while the parent can
// still take a prompt, and a reused worker's notice names its live task, not a stale done one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LeadDispatch } from '../src/server/dept-dispatch.js';
import type { Department, QueueTask, WorkerInfo } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerInfo['status'], more: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id, kind: 'agent', deskId: 'desk-1', name: id, color: '#fff', status, acked: true, createdBy: 'Kim', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], ...more };
}

function dept(over: Partial<Department> = {}): Department {
  return {
    id: 'dept-1', preset: 'marketing', name: 'Marketing', desks: [], rev: 0, roles: [], brief: [], briefArchived: 0, roster: [], assets: [],
    lead: { name: 'Maya', workerId: 'mgr-1', by: 'Kim', at: 0 },
    ...over,
  };
}

function fixture(opts: { ceo?: { name: string; workerId?: string }; objective?: boolean } = {}) {
  const ceo = opts.ceo ? { name: opts.ceo.name, workerId: opts.ceo.workerId, by: 'Kim', at: 0 } : undefined;
  const d = dept(opts.objective ? { lead: { name: 'Maya', workerId: 'mgr-1', by: 'Kim', at: 0, objective: { text: 'Ship the hero', by: 'Avery', at: 0 } } } : {});
  const tasks: QueueTask[] = [];
  const workers = new Map<string, WorkerInfo>();
  const prompted: { id: string; text: string }[] = [];
  const dispatch = new LeadDispatch({
    get: (id) => workers.get(id),
    prompt: (id, text) => {
      if (!workers.has(id)) return 'No such worker';
      prompted.push({ id, text });
      return undefined;
    },
    tasks: () => tasks,
    departments: () => [d],
    ceo: () => ceo,
  });
  const add = (w: WorkerInfo) => workers.set(w.id, w);
  const move = (w: WorkerInfo, status: WorkerInfo['status']) => {
    w.status = status;
    dispatch.onWorker(w);
  };
  return { dispatch, tasks, workers, prompted, add, move, d };
}

test('held notices flush one per idle turn, never into a busy terminal', () => {
  const f = fixture();
  const mgr = worker('mgr-1', 'working');
  f.add(mgr);
  const child = worker('child-1', 'working');
  f.add(child);
  f.tasks.push({ id: 't1', title: 'Job one', prompt: '', addedBy: 'Maya (lead)', addedAt: 1, status: 'running', workerId: 'child-1', dept: 'dept-1', parentId: 'mgr-1' });
  f.move(child, 'needs_input');
  child.activity = 'Which font?';
  f.move(child, 'done');
  assert.equal(f.prompted.length, 0, 'held while the manager works');
  // The manager's turn ends; the flush delivers the first line and starts a new turn.
  mgr.status = 'done';
  f.dispatch.onWorker(mgr);
  assert.equal(f.prompted.length, 1);
  assert.match(f.prompted[0].text, /ended its turn on “Job one”/);
  // The manager is now busy again (their next turn started with that prompt): nothing else fires,
  // and no second prompt is injected. A second held notice waits for the next idle.
  mgr.status = 'working';
  f.dispatch.onWorker(mgr); // no-op transition, but the held map must be untouched by flush-while-busy
  child.status = 'exited';
  f.tasks[0].status = 'done';
  f.tasks[0].outcome = 'exited';
  f.move(child, 'exited');
  assert.equal(f.prompted.length, 1, 'the second notice is held, not injected mid-turn');
  mgr.status = 'done';
  f.dispatch.onWorker(mgr);
  assert.equal(f.prompted.length, 2);
  assert.match(f.prompted[1].text, /stopped before finishing/);
});

test('a reused worker reports its live task, not a stale done one', () => {
  const f = fixture();
  const mgr = worker('mgr-1', 'idle');
  f.add(mgr);
  const child = worker('child-1', 'working');
  f.add(child);
  // The old task (done, worker reused after a retry) and the live one share the worker.
  f.tasks.push({ id: 'old', title: 'Old job', prompt: '', addedBy: 'Maya (lead)', addedAt: 1, status: 'done', outcome: 'done', finishedAt: 10, workerId: 'child-1', dept: 'dept-1', parentId: 'mgr-1' });
  f.tasks.push({ id: 'new', title: 'New job', prompt: '', addedBy: 'Maya (lead)', addedAt: 2, status: 'running', workerId: 'child-1', dept: 'dept-1', parentId: 'mgr-1', startedAt: 20 });
  f.move(child, 'needs_input');
  child.activity = 'Stuck on the new one';
  f.move(child, 'needs_input'); // no-op; ensure no double-fire
  assert.equal(f.prompted.length, 1);
  assert.match(f.prompted[0].text, /stopped on “New job”/);
  assert.ok(!f.prompted[0].text.includes('Old job'), 'the stale done task is not named');
});

test('a manager with a CEO objective rolls results and blockers up, held while the CEO works', () => {
  const f = fixture({ ceo: { name: 'Avery', workerId: 'ceo-1' }, objective: true });
  const mgr = worker('mgr-1', 'working');
  f.add(mgr);
  const ceo = worker('ceo-1', 'working');
  f.add(ceo);
  const child = worker('child-1', 'working');
  f.add(child);
  f.tasks.push({ id: 't1', title: 'Hero rebuild', prompt: '', addedBy: 'Maya (lead)', addedAt: 1, status: 'running', workerId: 'child-1', dept: 'dept-1', parentId: 'mgr-1' });
  f.move(child, 'done');
  // Manager busy: held. CEO busy: the rollup is held too — nothing injected anywhere.
  assert.equal(f.prompted.length, 0);
  mgr.status = 'done';
  f.dispatch.onWorker(mgr);
  assert.equal(f.prompted.length, 1, 'the manager got their line');
  ceo.status = 'done';
  f.dispatch.onWorker(ceo);
  assert.equal(f.prompted.length, 2, 'the CEO rollup flushes when the CEO is free');
  assert.match(f.prompted[1].text, /Maya \(Marketing\): .*ended its turn on “Hero rebuild”/);
  // A blocker rolls up too, condensed — the idle CEO hears it at once, while the manager's own
  // line waits out their turn:
  f.move(mgr, 'working');
  ceo.status = 'idle';
  f.dispatch.onWorker(ceo);
  child.status = 'needs_input';
  child.activity = 'Which headline?';
  f.move(child, 'needs_input');
  assert.equal(f.prompted.length, 3);
  assert.match(f.prompted[2].text, /Maya \(Marketing\): .*stopped on “Hero rebuild” — Which headline\?/);
  mgr.status = 'done';
  f.dispatch.onWorker(mgr);
  assert.equal(f.prompted.length, 4, 'the manager’s own held line follows when their turn ends');
  assert.match(f.prompted[3].text, /stopped on “Hero rebuild” — Which headline\?/);
});

test('without a CEO or objective, nothing rolls up and nothing loops', () => {
  const f = fixture();
  const mgr = worker('mgr-1', 'idle');
  f.add(mgr);
  const child = worker('child-1', 'working');
  f.add(child);
  f.tasks.push({ id: 't1', title: 'Solo job', prompt: '', addedBy: 'Maya (lead)', addedAt: 1, status: 'running', workerId: 'child-1', dept: 'dept-1', parentId: 'mgr-1' });
  f.move(child, 'done');
  assert.equal(f.prompted.length, 1);
  assert.equal(f.prompted[0].id, 'mgr-1');
  // The manager's own transition never re-notifies the manager (no self-parenting, no loop).
  f.move(mgr, 'done');
  assert.equal(f.prompted.length, 1);
});
