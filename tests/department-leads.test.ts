// Department leads (see docs/department-leads.md): the lead identity and its engine, the shift
// launch (resumed, never duplicated), the team engine policy, delegation dedupe on the one queue,
// and the engine-swap handoff brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Departments } from '../src/server/departments.js';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { swapBrief } from '../src/server/workers/handoffs.js';
import type { AgentProvider, WorkerInfo } from '../src/shared/protocol.js';

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-leads-'));
  const dataDir = path.join(base, 'data');
  const project = path.join(base, 'project');
  mkdirSync(project, { recursive: true });
  const departments = new Departments(dataDir, project, () => {});
  return { base, dataDir, project, departments, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a lead is named with a saved engine, replaced only off shift, and retires cleanly', () => {
  const { departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    assert.match(departments.setLead(d.id, { name: '   ' }, 'Kim')!, /Give the lead a name/);
    assert.equal(departments.setLead(d.id, { name: 'Maya', provider: 'kimi', model: 'kimi-code/kimi-for-coding' }, 'Kim'), undefined);
    const lead = departments.get(d.id)!.lead!;
    assert.equal(lead.name, 'Maya');
    assert.equal(lead.provider, 'kimi');
    assert.equal(lead.model, 'kimi-code/kimi-for-coding');
    // While the lead's worker is live, the identity can't be replaced under it.
    departments.recordLeadHire(d.id, 'w1', 'desk-1', 'Kim');
    assert.match(departments.setLead(d.id, { name: 'Zoe' }, 'Kim')!, /on shift/);
    // Retiring the lead clears the identity and the lead roster row; the worker itself stays rostered elsewhere.
    assert.equal(departments.clearLead(d.id), undefined);
    const after = departments.get(d.id)!;
    assert.equal(after.lead, undefined);
    assert.ok(!after.roster.some((r) => r.role === 'lead'));
  } finally {
    cleanup();
  }
});

test('the shift composes an orchestrator prompt, refuses a duplicate while live, and resumes a stale identity', () => {
  const { departments, cleanup } = setup();
  try {
    const d = departments.add('product', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    assert.match(departments.composeLeadLaunch(d.id, undefined, () => []) as string, /Name a lead first/);
    departments.setLead(d.id, { name: 'Priya' }, 'Kim');
    departments.brief(d.id, 'Ship the settings page', 0, 'Kim');
    const composed = departments.composeLeadLaunch(d.id, 'first: triage the queue', () => []);
    assert.ok(typeof composed !== 'string');
    assert.match(composed.prompt, /You are Priya, the Product & Engineering department's lead/);
    assert.match(composed.prompt, /You orchestrate/);
    assert.match(composed.prompt, /At most two implementation writers/);
    assert.match(composed.prompt, /Department brief \(rev 1, by Kim\):\nShip the settings page/);
    assert.match(composed.prompt, /office-workers review <url> --title/);
    assert.match(composed.prompt, /first: triage the queue/);
    // The lead doesn't consume the writer cap: even with two writers live, the shift composes.
    const story = departments.get(d.id)!.roles.find((r) => r.kind === 'implementation')!;
    departments.recordHire(d.id, story.id, 'w1', 'desk-1', 'Kim');
    assert.equal(departments.writers(() => ['w1', 'w2']), 2);
    departments.recordLeadHire(d.id, 'lead-1', 'desk-2', 'Kim');
    const again = departments.composeLeadLaunch(d.id, undefined, () => ['w1', 'w2', 'lead-1']);
    assert.match(again as string, /already on shift/);
    // The worker went home: the identity resumes on a fresh shift, stale link cleared.
    const resumed = departments.composeLeadLaunch(d.id, undefined, () => ['w1', 'w2']);
    assert.ok(typeof resumed !== 'string');
    assert.equal(departments.get(d.id)!.lead!.workerId, undefined);
  } finally {
    cleanup();
  }
});

test('the policy and the lead survive a reload; old files without them still load', () => {
  const { dataDir, project, departments, cleanup } = setup();
  try {
    const d = departments.add('review', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    departments.setLead(d.id, { name: 'Ravi', provider: 'codex' }, 'Kim');
    departments.setPolicy(d.id, { provider: 'claude', model: 'opus', mode: 'ask' }, 'Kim');
    const reloaded = new Departments(dataDir, project, () => {});
    const lead = reloaded.get(d.id)!.lead!;
    assert.equal(lead.name, 'Ravi');
    assert.equal(lead.provider, 'codex');
    const policy = reloaded.get(d.id)!.policy!;
    assert.equal(policy.provider, 'claude');
    assert.equal(policy.model, 'opus');
    assert.equal(policy.mode, 'ask');
  } finally {
    cleanup();
  }
});

function queueFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-leads-queue-'));
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: () => false,
    spawn(deskId, by, prompt, _worktree, _kind, provider, model, effort) {
      const worker: WorkerInfo = {
        id: `worker-${workers.length}`, deskId, kind: 'agent', provider, model, effort, prompt, name: 'Test',
        color: '#ffffff', status: 'working', acked: false, createdBy: by, createdAt: Date.now(),
        cols: 80, rows: 24, viewers: [], viewerIds: [],
      };
      workers.push(worker);
      return worker;
    },
    kill: (id) => {
      const i = workers.findIndex((w) => w.id === id);
      if (i >= 0) workers.splice(i, 1);
      return Promise.resolve({});
    },
  };
  const queue = new TaskQueue(dir, manager, false, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied: () => {} });
  return { queue, workers, close: () => { queue.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a department cannot be assigned the same live job twice; a finished one can be requeued', () => {
  const f = queueFixture();
  try {
    assert.equal(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1'), undefined);
    assert.match(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1')!, /already assigned/);
    // A different job is fine; another department with the same title is fine too.
    assert.equal(f.queue.add('Update the pricing page', 'Maya (lead)', 'Pricing page', undefined, 'claude', undefined, undefined, undefined, 'dept-1'), undefined);
    assert.equal(f.queue.add('Write the launch email', 'Dev (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-2'), undefined);
    const tasks = f.queue.state().tasks;
    assert.equal(tasks[0].dept, 'dept-1');
    assert.equal(tasks[2].dept, 'dept-2');
    // Once the job is finished, the same title can be delegated again.
    f.workers[0].status = 'done';
    f.queue.onWorker(f.workers[0]);
    assert.equal(f.queue.state().tasks[0].status, 'done');
    assert.equal(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1'), undefined);
  } finally {
    f.close();
  }
});

test('the engine swap brief says what moves, what stays, and that the evidence is unverified', () => {
  const source = {
    id: 'w1', kind: 'agent', deskId: 'desk-1', name: 'Muse', color: '#fff', status: 'done', acked: true,
    createdBy: 'Kim', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [],
    task: { name: 'Fix login redirect', summary: 'the /auth callback drops the query string' },
    prompt: 'Fix the login redirect',
    worktree: { path: '.agent-office/worktrees/muse', branch: 'office/muse-1', base: 'abc' },
  } as WorkerInfo;
  const brief = swapBrief(source, 'kimi', undefined);
  assert.match(brief.brief, /Take over “Fix login redirect: the \/auth callback drops the query string”, continuing it on kimi\./);
  assert.match(brief.brief, /Source branch: office\/muse-1 — left exactly as it is\./);
  assert.match(brief.brief, /do not spawn a duplicate of it/);
  assert.match(brief.evidence, /Explicitly unverified/);
  assert.match(brief.next, /Continue: Fix login redirect/);
  // A human note wins over the composed line.
  assert.match(swapBrief(source, 'kimi', 'Quota is gone; continue by hand.').brief, /Quota is gone/);
  // A worker with no task and no branch still composes something honest.
  const bare = { ...source, task: undefined, prompt: undefined, worktree: undefined } as WorkerInfo;
  const noBranch = swapBrief(bare, 'claude', undefined);
  assert.match(noBranch.brief, /no branch of its own/);
  assert.match(noBranch.next, /Ask the office what the worker was on/);
});
