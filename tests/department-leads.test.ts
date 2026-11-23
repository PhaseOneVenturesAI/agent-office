// Department leads (see docs/department-leads.md): the lead identity and its engine, the shift
// launch (resumed, never duplicated), the team engine policy, delegation ownership, the child→lead
// dispatch, and the engine-swap guards and handoff brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Departments } from '../src/server/departments.js';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { LeadDispatch } from '../src/server/dept-dispatch.js';
import { swapBrief, swapGuard } from '../src/server/workers/handoffs.js';
import type { AgentProvider, Department, QueueTask, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

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

test('one project-wide owner per job: any live task with the same normalized title blocks the claim', () => {
  const f = queueFixture();
  try {
    assert.equal(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1', 'lead-1'), undefined);
    // Same title, same department: refused.
    assert.match(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1', 'lead-1')!, /already assigned/);
    // Same title, ANOTHER department: also refused — ownership is project-wide.
    assert.match(f.queue.add('Write the launch email', 'Dev (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-2')!, /already assigned/);
    // Normalized match: case, extra inner whitespace and surrounding space still claim the job.
    assert.match(f.queue.add('Any prompt', 'Dev (lead)', '  LAUNCH   email ', undefined, 'claude')!, /already assigned/);
    // A different job is fine.
    assert.equal(f.queue.add('Update the pricing page', 'Maya (lead)', 'Pricing page', undefined, 'claude', undefined, undefined, undefined, 'dept-1'), undefined);
    const tasks = f.queue.state().tasks;
    assert.equal(tasks[0].dept, 'dept-1');
    assert.equal(tasks[0].parentId, 'lead-1');
    assert.equal(tasks[1].dept, 'dept-1');
    assert.equal(tasks[1].parentId, undefined);
    // Once the job is finished, the title is free again.
    f.workers[0].status = 'done';
    f.queue.onWorker(f.workers[0]);
    assert.equal(f.queue.state().tasks[0].status, 'done');
    assert.equal(f.queue.add('Write the launch email', 'Maya (lead)', 'Launch email', undefined, 'claude', undefined, undefined, undefined, 'dept-1'), undefined);
  } finally {
    f.close();
  }
});

test('the engine swap brief says what moves, what stays, and that the evidence is unverified', () => {  const source = {
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

// --- Ask-policy requests, swap relink, guards ----------------------------------------------------------------

test('an ask-policy delegation waits as a request a person decides; relink follows a landed swap', () => {
  const { dataDir, project, departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    assert.match(departments.addRequest(d.id, { title: '', task: 'x', by: 'Maya' })!, /title and the task/);
    assert.equal(departments.addRequest(d.id, { title: 'Hero rewrite', task: 'Redo the hero section', by: 'Maya' }), undefined);
    assert.match(departments.addRequest(d.id, { title: 'Hero rewrite', task: 'Again', by: 'Maya' })!, /already waiting/);
    assert.equal(departments.get(d.id)!.requests!.length, 1);
    // Approving takes it out; a second take is gone.
    const taken = departments.takeRequest(d.id, departments.get(d.id)!.requests![0].id);
    assert.ok(typeof taken !== 'string');
    assert.equal(taken.title, 'Hero rewrite');
    assert.equal(departments.get(d.id)!.requests!.length, 0);
    assert.match(departments.takeRequest(d.id, taken.id) as string, /gone/);
    // Rejecting drops it.
    assert.equal(departments.addRequest(d.id, { title: 'Footer', task: 'Fix the footer', by: 'Maya' }), undefined);
    const req = departments.get(d.id)!.requests![0];
    assert.equal(departments.dropRequest(d.id, req.id), undefined);
    assert.equal(departments.get(d.id)!.requests!.length, 0);
    // Requests survive a reload.
    departments.addRequest(d.id, { title: 'Nav', task: 'Rework the nav', by: 'Maya' });
    const reloaded = new Departments(dataDir, project, () => {});
    assert.equal(reloaded.get(d.id)!.requests!.length, 1);
    // A landed swap moves the lead identity and roster rows to the replacement, policy untouched.
    departments.setLead(d.id, { name: 'Maya' }, 'Kim');
    departments.setPolicy(d.id, { provider: 'kimi', mode: 'policy' }, 'Kim');
    departments.recordLeadHire(d.id, 'old-lead', 'desk-1', 'Kim');
    const story = departments.get(d.id)!.roles.find((r) => r.name === 'Story')!;
    departments.recordHire(d.id, story.id, 'old-writer', 'desk-2', 'Kim');
    departments.relinkWorker('old-lead', 'new-lead');
    departments.relinkWorker('old-writer', 'new-writer');
    const after = departments.get(d.id)!;
    assert.equal(after.lead!.workerId, 'new-lead');
    assert.equal(after.roster.find((r) => r.role === 'lead')!.workerId, 'new-lead');
    assert.equal(after.roster.find((r) => r.role === story.id)!.workerId, 'new-writer');
    assert.equal(after.policy!.provider, 'kimi');
    // The lead's department is findable from the worker (parent ownership checks).
    assert.equal(departments.leadDeptOfWorker('new-lead')!.id, d.id);
    assert.equal(departments.leadDeptOfWorker('nobody'), undefined);
  } finally {
    cleanup();
  }
});

// --- The lead dispatch: children report transitions to the lead's session ------------------------------------

function dispatchFixture(leadStatus: WorkerStatus = 'idle') {
  const lead: WorkerInfo = { id: 'lead-1', kind: 'agent', deskId: 'desk-1', name: 'Maya', color: '#fff', status: leadStatus, acked: true, createdBy: 'Kim', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };
  const child: WorkerInfo = { id: 'child-1', kind: 'agent', deskId: 'desk-2', name: 'Pip', color: '#fff', status: 'working', acked: true, createdBy: 'Kim', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };
  const dept: Department = {
    id: 'dept-1', preset: 'marketing', name: 'Marketing', desks: [], rev: 0, roles: [], brief: [], briefArchived: 0,
    roster: [], assets: [], lead: { name: 'Maya', workerId: 'lead-1', by: 'Kim', at: 0 },
  };
  const task: QueueTask = { id: 'task-1', title: 'Hero rewrite', prompt: 'Redo it', addedBy: 'Maya (lead)', addedAt: 0, status: 'running', workerId: 'child-1', dept: 'dept-1', parentId: 'lead-1' };
  const workers = new Map([[lead.id, lead], [child.id, child]]);
  const prompted: string[] = [];
  const dispatch = new LeadDispatch({
    get: (id) => workers.get(id),
    prompt: (id, text) => {
      if (!workers.has(id)) return 'No such worker';
      prompted.push(text);
      return undefined;
    },
    tasks: () => [task],
    departments: () => [dept],
  });
  return { lead, child, dept, task, workers, dispatch, prompted };
}

test('a child’s transitions reach the lead as prompts: delivered when idle, coalesced while busy', () => {
  const f = dispatchFixture('idle');
  // Turn ended: delivered at once, with the job and the not-yet-reviewed PR.
  f.task.pr = { number: 7, url: 'https://github.com/acme/app/pull/7', state: 'open', title: 'Hero' };
  f.child.status = 'done';
  f.dispatch.onWorker(f.child);
  assert.equal(f.prompted.length, 1);
  assert.match(f.prompted[0], /Pip ended its turn on “Hero rewrite”/);
  assert.match(f.prompted[0], /PR #7 opened \(not yet reviewed\)/);
  // Blocker while the lead works: held, not typed into a running turn.
  f.lead.status = 'working';
  f.child.status = 'needs_input';
  f.child.activity = 'Which headline?';
  f.dispatch.onWorker(f.child);
  assert.equal(f.prompted.length, 1, 'nothing delivered mid-turn');
  // ...a newer transition coalesces to the latest notice per child.
  f.child.activity = 'Font choice?';
  f.dispatch.onWorker({ ...f.child, status: 'working' });
  f.child.status = 'needs_input';
  f.dispatch.onWorker(f.child);
  // The lead's turn ends: the held notice flushes.
  f.lead.status = 'done';
  f.dispatch.onWorker(f.lead);
  assert.equal(f.prompted.length, 2);
  assert.match(f.prompted[1], /Font choice\?/);
  assert.ok(!f.prompted[1].includes('Which headline?'), 'only the latest notice per child');
});

test('the dispatch is receipt-protected and bounded: gone leads drop, strangers are ignored', () => {
  const f = dispatchFixture('working');
  f.child.status = 'done';
  f.dispatch.onWorker(f.child);
  assert.equal(f.prompted.length, 0);
  // The lead goes home: its held notices drop with it, never replayed.
  f.workers.delete('lead-1');
  f.lead.status = 'done';
  f.dispatch.onWorker(f.lead);
  f.dispatch.onWorkerGone('lead-1');
  const child2: WorkerInfo = { ...f.child, id: 'child-2', status: 'needs_input' };
  f.workers.set('child-2', child2);
  f.task.workerId = 'child-2';
  f.dispatch.onWorker(child2);
  assert.equal(f.prompted.length, 0, 'a gone lead is never prompted and notices are not replayed');
  // A worker with no delegated task is nobody's child.
  const stranger: WorkerInfo = { ...f.child, id: 'lone-1', status: 'done' };
  f.workers.set('lone-1', stranger);
  f.dispatch.onWorker(stranger);
  assert.equal(f.prompted.length, 0);
  // A task killed with no transition to carry it still reaches the lead.
  f.lead.status = 'idle';
  f.workers.set('lead-1', f.lead);
  f.dispatch.onTaskFinished({ ...f.task, status: 'done', outcome: 'killed', workerName: 'Pip' });
  assert.equal(f.prompted.length, 1);
  assert.match(f.prompted[0], /sent home mid-job/);
});

test('delegation binds the approved context: current brief, current references, skills that actually exist here', () => {
  const { project, departments, cleanup } = setup();
  try {
    mkdirSync(path.join(project, 'docs'), { recursive: true });
    const harness = mkdtempSync(path.join(tmpdir(), 'agent-office-harness-'));
    try {
      mkdirSync(path.join(harness, 'skills', 'copywriting'), { recursive: true });
      writeFileSync(path.join(harness, 'skills', 'copywriting', 'SKILL.md'), '# copy\n');
      const d = departments.add('marketing', undefined, 'Kim');
      assert.ok(typeof d !== 'string');
      departments.brief(d.id, 'Clarity over cleverness', 0, 'Kim');
      departments.addAsset(d.id, { label: 'Voice guide', kind: 'link', ref: 'https://example.com/voice', status: 'current' }, 'Kim');
      departments.addAsset(d.id, { label: 'Old look', kind: 'link', ref: 'https://example.com/old', status: 'historical' }, 'Kim');
      const bound = departments.contextNote(d.id, harness);
      assert.ok(typeof bound !== 'string');
      assert.equal(bound.brief, 1);
      assert.match(bound.note, /Brief rev 1 \(current\): Clarity over cleverness/);
      assert.match(bound.note, /Voice guide/);
      assert.ok(!bound.note.includes('Old look'), 'historical references stay out of the approved context');
      assert.match(bound.note, /skills\/copywriting\/SKILL\.md/);
      assert.match(bound.note, /NOT present.*frontend-design\/SKILL\.md/s, 'absent skills are named as unavailable, never claimed');
    } finally {
      rmSync(harness, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});

test('a retry supersedes the original: new id, audit kept, context drift flagged', () => {
  const f = queueFixture();
  try {
    assert.equal(f.queue.add('Do the thing', 'Maya (lead)', 'The thing', undefined, 'claude', undefined, undefined, undefined, 'dept-1', 'lead-1', { brief: 1, at: 1000 }), undefined);
    const original = f.queue.state().tasks[0];
    f.workers[0].status = 'done';
    f.queue.onWorker(f.workers[0]);
    // Same brief: no drift.
    const same = f.queue.retry(original.id, () => ({ prompt: 'Do the thing', contextRev: { brief: 1, at: 2000 } }));
    assert.equal(same, undefined);
    const retried = f.queue.state().tasks[1];
    assert.notEqual(retried.id, original.id);
    assert.equal(retried.supersedes, original.id);
    assert.equal(retried.staleContext, undefined);
    assert.equal(f.queue.state().tasks[0].outcome, 'done', 'the original record stays in the audit');
    // Brief moved: flagged, and the worker is told.
    f.workers[1].status = 'done';
    f.queue.onWorker(f.workers[1]);
    const moved = f.queue.retry(retried.id, () => ({ prompt: 'Do the thing (v2 brief)', contextRev: { brief: 2, at: 3000 } }));
    assert.equal(moved, undefined);
    const third = f.queue.state().tasks[2];
    assert.equal(third.staleContext, true);
    assert.match(third.prompt, /v2 brief/, 'the retried prompt carries the refreshed context');
    // The chain of custody is intact end to end.
    assert.equal(f.queue.state().tasks[1].supersedes, original.id);
    assert.equal(third.supersedes, retried.id);
    assert.equal(third.parentId, 'lead-1', 'ownership survives the retry intact');
  } finally {
    f.close();
  }
});

// --- Swap guards: every refusal fires before a replacement spawns ---------------------------------------------

test('a swap is refused before anything spawns: busy, pending handoff, or already reserved', () => {
  const base: WorkerInfo = { id: 'w1', kind: 'agent', deskId: 'desk-1', name: 'Muse', color: '#fff', status: 'done', acked: true, createdBy: 'Kim', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };
  assert.equal(swapGuard(base), undefined);
  assert.match(swapGuard({ ...base, kind: 'shell' })!, /agent worker/);
  assert.match(swapGuard({ ...base, status: 'working' })!, /wait until its turn ends/);
  assert.match(swapGuard({ ...base, status: 'needs_input' })!, /wait until its turn ends/);
  const pending = { id: 'h1', from: 'w1', to: 'w2', fromName: 'a', toName: 'b', fromPath: '/a', toPath: '/b', fromBranch: 'a', toBranch: 'b', brief: 'b', evidence: 'e', next: 'n', by: 'k', at: 0, state: 'pending' as const, prompt: 'p' };
  assert.match(swapGuard({ ...base, handoff: pending })!, /pending handoff/);
  assert.match(swapGuard({ ...base, swap: { engine: 'kimi', by: 'Kim', at: 0 } })!, /Already being swapped/);
});
