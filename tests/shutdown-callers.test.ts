import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { floorHelpers } from '../src/server/office/floors.js';
import { WorkerTrees } from '../src/server/workers/worktree.js';
import { WorkerManager } from '../src/server/workers/manager.js';
import { newWorker } from '../src/server/workers/worker.js';
import { Ledger, newTracker } from '../src/server/usage.js';
import { AcpClosures } from '../src/server/acp-shutdown.js';
import { TaskQueue } from '../src/server/queue.js';
import { MeetingRoom } from '../src/server/meetings.js';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

test('floor stays registered and visible to concurrent server shutdown until its children exit', async () => {
  const d = deferred(); let removed = false, published = false;
  const floor: any = { id: 'floor', def: { name: 'Project' }, info: () => ({ id: 'floor' }), shutdown: () => d.promise };
  const ctx: any = { floors: new Map([['floor', floor]]), clients: new Map(), building: { isLocal: () => false, pending: () => [], remove: () => { removed = true; return floor.def; } }, broadcast: () => { published = true; }, pumpQueues() {} };
  const helpers = floorHelpers(ctx);
  const result = helpers.closeFloor(floor, 'Owner');
  try {
    assert.equal(ctx.floors.has('floor'), true);
    assert.equal(removed, false); assert.equal(published, false);
    const pending = [...ctx.floors.values()].map((f: any) => f.shutdown());
    assert.equal(pending.length, 1);
    d.resolve(); await result; await Promise.all(pending);
    assert.equal(ctx.floors.has('floor'), false); assert.equal(removed, true);
  } finally { d.resolve(); await result; helpers.cancelFloorsChanged(); }
});

test('failed floor shutdown retains its registry entry and reports the error without publishing removal', async () => {
  const d = deferred(); let removed = false, published = false, stops = 0;
  const floor: any = { id: 'floor', def: { name: 'Project' }, shutdown: () => { stops++; return d.promise; } };
  const ctx: any = { floors: new Map([['floor', floor]]), clients: new Map(), building: { remove: () => { removed = true; } }, broadcast: () => { published = true; } };
  const helpers = floorHelpers(ctx);
  const first = helpers.closeFloor(floor, 'Owner'), second = helpers.closeFloor(floor, 'Owner');
  assert.equal(first, second); assert.equal(stops, 1);
  d.reject(new Error('child still alive'));
  assert.match((await first)!, /Kept Project.*child still alive/);
  assert.equal(ctx.floors.get('floor'), floor); assert.equal(removed, false); assert.equal(published, false);
  helpers.cancelFloorsChanged();
});

test('worktree restart waits for tracked ACP close and preserves the old session on failure', async () => {
  for (const fails of [false, true]) {
    const d = deferred(), tracker = new AcpClosures(); let resumed = 0;
    const session: any = { close: () => d.promise };
    const worker: any = { info: { id: 'w', kind: 'agent', status: 'idle' }, dsh: session };
    const ctx: any = { workers: new Map([['w', worker]]), closing: false, resume: () => { resumed++; }, closeAcp: (s: any) => tracker.close(s), persist() {}, emit() {} };
    const trees: any = new WorkerTrees(ctx);
    const result = Promise.resolve(trees.restartIn(worker));
    try {
      assert.equal(resumed, 0);
      assert.equal(worker.dsh, session);
      if (fails) d.reject(new Error('child still alive')); else d.resolve();
      const error = await result;
      assert.equal(resumed, fails ? 0 : 1);
      if (fails) { assert.match(error, /child still alive/); assert.equal(worker.dsh, session); }
    } finally { d.resolve(); await result.catch(() => {}); }
  }
});

test('worker removal keeps its seat reserved, coalesces requests, and preserves records on stop failure', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-stop-seat-')), data = path.join(dir, '.agent-office'); mkdirSync(data);
  const manager = new WorkerManager(dir, data, '/usr/bin/true', [], { url: 'http://127.0.0.1:1', token: '' }, { update() {}, remove() {}, data() {}, screen() {}, toast() {} }, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
  t.after(async () => { await manager.shutdown().catch(() => {}); rmSync(dir, { recursive: true, force: true }); });
  const d = deferred(); let closes = 0;
  const worker = newWorker({ id: 'old', deskId: 'desk-1', kind: 'agent', provider: 'kimi', status: 'idle', name: 'Owner' } as any, newTracker());
  worker.dsh = { close: () => { closes++; return d.promise; } } as any;
  (manager as any).workers.set('old', worker);
  const first = manager.kill('old'), second = manager.kill('old');
  try {
    assert.equal(manager.deskOccupied('desk-1'), true);
    assert.equal(manager.get('old'), worker.info);
    assert.equal(closes, 1);
    // The real child exit callback clears its session before the awaited stop continuation.
    // Even in that window, neither a prompt nor resume may start another child.
    const session = worker.dsh; worker.dsh = undefined;
    assert.match(manager.resume('old')!, /stopping/);
    assert.match(manager.prompt('old', 'Do new work')!, /stopping/);
    let writes = 0;
    worker.pty = { write: () => writes++ } as any;
    manager.write('old', 'Do new work', 'Owner');
    assert.equal(writes, 0);
    worker.pty = undefined; worker.dsh = session;
    d.reject(new Error('child still alive'));
    assert.match((await first).error!, /child still alive/); assert.match((await second).error!, /child still alive/);
    assert.equal(manager.list().length, 1); assert.equal(manager.deskOccupied('desk-1'), true);
  } finally { d.resolve(); await Promise.all([first, second]); worker.dsh = undefined; }
});

test('queue never recycles a seat before asynchronous worker removal succeeds', async () => {
  const d = deferred(); let kills = 0, pumps = 0;
  const q: any = Object.create(TaskQueue.prototype);
  Object.assign(q, { recycling: false, workers: { kill: () => { kills++; return d.promise.then(() => ({})); } }, events: { toast() {} }, recyclable: () => ({ w: { id: 'old', deskId: 'desk-1', name: 'Owner' }, t: { title: 'task', prompt: 'task' } }), pump: () => pumps++ });
  try {
    assert.equal(q.recycleDesk(), undefined); assert.equal(q.recycleDesk(), undefined);
    assert.equal(kills, 1); assert.equal(pumps, 0);
    d.resolve(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(pumps, 1);
  } finally { d.resolve(); }
});

test('a failed queue removal leaves its seat unavailable without an immediate retry loop', async () => {
  let kills = 0, pumps = 0;
  const warnings: string[] = [];
  const q: any = Object.create(TaskQueue.prototype);
  Object.assign(q, { recycling: false, workers: { kill: async () => { kills++; return { error: 'child still alive' }; } }, events: { toast: (text: string) => warnings.push(text) }, recyclable: () => ({ w: { id: 'old', deskId: 'desk-1', name: 'Owner' }, t: { title: 'task', prompt: 'task' } }), pump: () => pumps++ });
  assert.equal(q.recycleDesk(), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kills, 1); assert.equal(pumps, 0); assert.equal(q.recycling, false);
  assert.match(warnings.join(' '), /child still alive/);
});

test('meeting dismissal retains ownership and never cleans a workspace when any worker fails to stop', async () => {
  let cleaned = false;
  const room: any = Object.create(MeetingRoom.prototype);
  Object.assign(room, { dismissals: new Map(), workers: { list: () => [{ id: 'w' }], kill: async () => ({ error: 'child still alive' }) }, trees: { inspect: async () => { cleaned = true; return { dirty: 0, ahead: 0 }; }, remove: async () => { cleaned = true; } }, events: { toast() {} }, dir: '/fixture', cwd: () => '/fixture/tree', persist() {} });
  const m: any = { id: 'm', title: 'Review', seats: [{ workerId: 'w' }], worktree: { path: 'tree', branch: 'work' }, pattern: 'test' };
  await room.dismiss(m);
  assert.equal(cleaned, false); assert.notEqual(m.cleared, true);
});

test('meeting clear retains current ownership while stopping and after a stop failure', async () => {
  const d = deferred(); let cleaned = false;
  const m: any = { id: 'm', title: 'Review', status: 'stopped', seats: [{ workerId: 'w' }], worktree: { path: 'tree', branch: 'work' }, pattern: 'test' };
  const room: any = Object.create(MeetingRoom.prototype);
  Object.assign(room, { current: m, past: [], dismissals: new Map(), workers: { list: () => [{ id: 'w' }], kill: () => d.promise.then(() => ({ error: 'child still alive' })) }, trees: { inspect: async () => { cleaned = true; return {}; } }, events: { toast() {} }, dir: '/fixture', cwd: () => '/fixture/tree', persist() {} });
  try {
    assert.equal(room.clear('Owner'), undefined);
    assert.equal(room.current, m); assert.equal(cleaned, false);
    d.resolve(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(room.current, m); assert.equal(cleaned, false); assert.deepEqual(room.past, []);
  } finally { d.resolve(); }
});
