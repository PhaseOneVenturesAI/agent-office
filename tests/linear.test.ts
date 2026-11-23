import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { LinearService } from '../src/server/linear/service.js';
import { LinearClient, type LinearConfig } from '../src/server/linear/client.js';
import { LinearStore, type LinearIssue } from '../src/server/linear/store.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
const config: LinearConfig = { clientId: 'test-client', clientSecret: 'test-secret', webhookSecret: 'test-webhook', origin: 'https://office.example', ownerAccountId: 'owner', organizationId: 'org' };
const issue = (): LinearIssue => ({ id: randomUUID(), identifier: 'PLI-1', title: 'Keep the mascot consistent', description: 'Follow the approved illustrations', updatedAt: new Date().toISOString(), url: 'https://linear.app/test/issue/PLI-1', team: { id: 'team' }, assignee: { id: 'ivan-linear', name: 'Ivan' }, state: { id: 'todo', name: 'To do', type: 'unstarted' } });
function fixture(t: test.TestContext, controller: ConstructorParameters<typeof LinearService>[4] = () => false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-linear-')), workers: WorkerInfo[] = [], remote = new Map<string, LinearIssue>();
  const calls: { query: string; variables: Record<string, any> }[] = [];
  let loseCreate = false;
  const manager: QueueWorkers = { defaultProvider: 'claude', list: () => workers, deskOccupied: () => false, kill: async () => ({}),
    spawn(deskId, by, prompt, worktree, kind, provider, model, effort, meeting, owner) {
      const w = { id: randomUUID(), name: 'Pixel', deskId, provider, kind, status: 'working', viewers: [], owner } as unknown as WorkerInfo;
      workers.push(w); return w;
    } };
  const queue = new TaskQueue(dir, manager, false, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
  const request: typeof fetch = async (_url, init) => {
    const { query, variables } = JSON.parse(String(init?.body)); calls.push({ query, variables });
    let data: unknown;
    if (query.includes('issueCreate')) {
      const input = variables.input, created = { ...issue(), id: input.id, title: input.title, description: input.description, team: { id: input.teamId }, assignee: input.assigneeId ? { id: input.assigneeId, name: 'Ivan' } : null, state: { id: input.stateId ?? 'todo', name: 'To do', type: 'unstarted' } };
      assert.ok(!remote.has(created.id), 'must never create duplicate UUID'); remote.set(created.id, created);
      if (loseCreate) { loseCreate = false; throw new Error('response lost'); }
      data = { issueCreate: { success: true, issue: created } };
    } else if (query.includes('issueUpdate')) {
      const found = remote.get(variables.id)!; Object.assign(found, variables.input);
      if ('assigneeId' in variables.input) found.assignee = variables.input.assigneeId ? { id: variables.input.assigneeId, name: 'Eddie' } : null;
      if (variables.input.stateId) found.state = { id: variables.input.stateId, name: variables.input.stateId, type: variables.input.stateId === 'completed' ? 'completed' : 'started' };
      data = { issueUpdate: { success: true, issue: found } };
    } else if (query.includes('issues(')) {
      const id = variables.filter?.id?.eq; data = { issues: { nodes: [...remote.values()].filter((i) => !id || i.id === id), pageInfo: { hasNextPage: false, endCursor: '' } } };
    } else throw new Error(`Unexpected query: ${query}`);
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const service = new LinearService(dir, config, () => [{ id: 'floor', queue, departments: { state: () => ({ departments: [{ id: 'marketing', name: 'Marketing' }, { id: 'development', name: 'Development' }] }) } }], () => [{ id: 'owner', name: 'Owner' }, { id: 'ivan', name: 'Ivan' }, { id: 'eddie', name: 'Eddie' }], (account, scope) => account === 'owner' || !!controller?.(account, scope), request);
  Object.assign(service.store.data, { token: { access: 'fake', refresh: 'fake-refresh', expiresAt: Date.now() + 3600000 }, organization: { id: 'org', name: 'Test' }, people: [{ id: 'ivan-linear', name: 'Ivan', email: 'ivan@example.test' }, { id: 'eddie-linear', name: 'Eddie', email: 'eddie@example.test' }], teams: [{ id: 'team', name: 'Plimbo', key: 'PLI', states: [{ id: 'todo', name: 'To do', type: 'unstarted' }, { id: 'progress', name: 'In progress', type: 'started' }, { id: 'completed', name: 'Complete', type: 'completed' }] }], mappings: [{ floorId: 'floor', teamId: 'team', states: { todo: 'todo', inProgress: 'progress', completed: 'completed' } }], userMap: { 'ivan-linear': 'ivan', 'eddie-linear': 'eddie' } });
  service.store.save();
  t.after(() => { service.close(); queue.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, queue, workers, remote, calls, service, loseNextCreate() { loseCreate = true; } };
}

test('Linear imports are dormant, survive restart, and never spawn until the assignee explicitly starts', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run();
  const task = f.queue.state().tasks[0]; assert.equal(task.status, 'planned'); assert.equal(task.linear?.accountId, 'ivan'); assert.equal(f.workers.length, 0);
  assert.match(f.queue.startOwn(task.id, 'eddie', 'Eddie', 'codex') ?? '', /assigned/);
  assert.match(f.queue.retry(task.id) ?? '', /Start my agent/);
  assert.equal(f.queue.startOwn(task.id, 'ivan', 'Ivan', 'kimi'), undefined);
  assert.equal(f.workers[0].owner, 'ivan'); assert.equal(f.workers[0].provider, 'kimi');
  f.workers[0].status = 'done'; f.queue.onWorker(f.workers[0]);
  assert.equal(f.queue.state().tasks[0].linear?.workStatus, 'todo', 'ending a turn is not business completion');
  f.queue.clear(); assert.equal(f.queue.state().tasks.length, 1);
});

test('webhooks require raw signature, freshness and workspace; duplicates import once without spawning', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item);
  const delivery = randomUUID(), payload = { webhookTimestamp: Date.now(), organizationId: 'org', type: 'Issue', action: 'update', data: { id: item.id } };
  const raw = Buffer.from(JSON.stringify(payload)), sign = (b: Buffer) => createHmac('sha256', config.webhookSecret).update(b).digest('hex');
  assert.throws(() => f.service.webhook(raw, '00'.repeat(32), delivery), /Invalid/);
  const stale = Buffer.from(JSON.stringify({ ...payload, webhookTimestamp: Date.now() - 120000 })); assert.throws(() => f.service.webhook(stale, sign(stale), delivery), /Expired/);
  const other = Buffer.from(JSON.stringify({ ...payload, organizationId: 'another' })); assert.throws(() => f.service.webhook(other, sign(other), delivery), /foreign/);
  f.service.webhook(raw, sign(raw), delivery); f.service.webhook(raw, sign(raw), delivery); await f.service.sync!.run();
  assert.equal(f.queue.state().tasks.length, 1); assert.equal(f.workers.length, 0); assert.equal(f.service.store.data.deliveries.length, 1);
});

test('ambiguous creates reuse the persisted UUID and do not duplicate a Linear issue or local task', async (t) => {
  const f = fixture(t); f.loseNextCreate();
  await f.service.edit('owner', 'floor', undefined, { title: 'Review the hero', description: 'Approved style', assigneeId: 'ivan-linear', stateId: 'todo' });
  await f.service.sync!.run(); assert.equal(f.remote.size, 1); assert.equal(f.service.store.data.outbox.length, 1);
  const id = [...f.remote.keys()][0];
  const future = Date.now() + 120000; t.mock.method(Date, 'now', () => future); await f.service.sync!.run();
  assert.equal(f.remote.size, 1); assert.equal(f.service.store.data.outbox.length, 0); assert.equal(f.queue.state().tasks.length, 1);
  assert.equal(f.queue.state().tasks[0].linear?.issueId, id); assert.equal(f.calls.filter((c) => c.query.includes('issueCreate')).length, 1);
  assert.ok(f.calls.every((c) => !('delegateId' in (c.variables.input ?? {}))));
});

test('staff can edit assigned tasks but cannot assign other people, create broad work, or use someone else’s task', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run(); const task = f.queue.state().tasks[0];
  await assert.rejects(f.service.edit('eddie', 'floor', task.id, { title: 'Changed' }), /assignee/);
  await assert.rejects(f.service.edit('ivan', 'floor', task.id, { assigneeId: 'eddie-linear' }), /controller/);
  await assert.rejects(f.service.edit('ivan', 'floor', undefined, { title: 'Create work' }), /controller/);
  await f.service.edit('ivan', 'floor', task.id, { stateId: 'progress' }); await f.service.sync!.run();
  assert.equal(f.remote.get(item.id)?.state.id, 'progress'); assert.equal(f.workers.length, 0);
});

test('same-field conflicts require a decision and assignment sync does not transfer running credentials', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run(); const task = f.queue.state().tasks[0];
  f.queue.startOwn(task.id, 'ivan', 'Ivan', 'claude');
  f.service.store.data.outbox.push({ floorId: 'floor', taskId: task.id, issueId: item.id, base: { ...f.service.store.data.bases[item.id] }, patch: { title: 'Office title' } });
  item.title = 'Linear title'; item.assignee = { id: 'eddie-linear', name: 'Eddie' };
  await f.service.sync!.run(); const updated = f.queue.state().tasks[0];
  assert.match(updated.linear?.conflict ?? '', /title/); assert.equal(item.title, 'Linear title'); assert.equal(updated.owner, 'ivan'); assert.equal(updated.linear?.accountId, 'eddie');
  assert.equal(f.queue.startOwn(task.id, 'eddie', 'Eddie', 'codex'), 'Wait for the pending Linear changes to sync first');
  await f.service.edit('owner', 'floor', task.id, {}, 'remote'); await f.service.sync!.run();
  assert.equal(f.queue.state().tasks[0].title, 'Linear title'); assert.equal(f.service.store.data.outbox.length, 0);
});

test('OAuth state is bound to configured owner; refresh is single-flight and credentials never appear in public state', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'linear-oauth-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new LinearStore(dir); let tokens = 0;
  const client = new LinearClient(config, store, async (url, init) => {
    if (String(url).includes('/oauth/token')) { tokens++; await new Promise((r) => setTimeout(r, 10)); return new Response(JSON.stringify({ access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 86400 })); }
    return new Response(JSON.stringify({ data: { organization: { id: 'org' } } }));
  });
  assert.throws(() => client.authorize('ivan'), /owner/);
  const url = new URL(client.authorize('owner')); assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('actor'), 'app');
  await assert.rejects(client.exchange('ivan', url.searchParams.get('state')!, 'code'), /another account/);
  const next = new URL(client.authorize('owner')); await client.exchange('owner', next.searchParams.get('state')!, 'code');
  store.data.token!.expiresAt = 0; await Promise.all([client.graphql('query{organization{id}}'), client.graphql('query{organization{id}}')]); assert.equal(tokens, 2);
  const service = new LinearService(dir, undefined, () => [], () => []); t.after(() => service.close());
  assert.ok(!JSON.stringify(service.state('owner', 'floor')).includes('secret-'));
});


test('department controllers cannot manage another department or unscoped work', async (t) => {
  const f = fixture(t, (account, scope) => account === 'eddie' && scope.departmentId === 'development');
  const marketing = issue(), development = issue();
  f.remote.set(marketing.id, marketing); f.remote.set(development.id, development);
  f.service.store.data.links[marketing.id] = { floorId: 'floor', taskId: 'marketing-task', departmentId: 'marketing' };
  f.service.store.data.links[development.id] = { floorId: 'floor', taskId: 'development-task', departmentId: 'development' };
  await f.service.sync!.run();
  await assert.rejects(f.service.edit('eddie', 'floor', 'marketing-task', { title: 'Wrong department' }), /assignee/);
  await assert.rejects(f.service.edit('eddie', 'floor', undefined, { title: 'Unscoped' }), /controller/);
  await f.service.edit('eddie', 'floor', 'development-task', { title: 'Authorized department' }); await f.service.sync!.run();
  assert.equal(f.remote.get(development.id)?.title, 'Authorized department');
  const state = f.service.state('eddie', 'floor');
  assert.equal(state.taskPermissions['marketing-task'].edit, false);
  assert.equal(state.taskPermissions['development-task'].edit, true);
  assert.equal(state.departments.find((d) => d.id === 'marketing')?.canCreate, false);
  assert.equal(state.departments.find((d) => d.id === 'development')?.canCreate, true);
});

test('missing mapping never guesses an employee or authorizes a paid worker', async (t) => {
  const f = fixture(t), item = issue(); f.service.store.data.userMap = {}; f.remote.set(item.id, item); await f.service.sync!.run();
  const task = f.queue.state().tasks[0]; assert.equal(task.linear?.accountId, undefined);
  assert.match(f.queue.startOwn(task.id, 'ivan', 'Ivan', 'claude') ?? '', /assigned/);
  assert.equal(f.service.state(undefined, 'floor').taskPermissions[task.id].edit, false);
});

test('delivery tombstones preserve task and conversation references', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run();
  const task = f.queue.state().tasks[0]; f.queue.startOwn(task.id, 'ivan', 'Ivan', 'claude');
  f.remote.delete(item.id); const delivery = randomUUID();
  const raw = Buffer.from(JSON.stringify({ webhookTimestamp: Date.now(), organizationId: 'org', type: 'Issue', action: 'remove', data: { id: item.id } }));
  f.service.webhook(raw, createHmac('sha256', config.webhookSecret).update(raw).digest('hex'), delivery); await f.service.sync!.run();
  assert.equal(f.queue.state().tasks.length, 1); assert.equal(f.queue.state().tasks[0].linear?.archived, true); assert.equal(f.workers.length, 1);
});

test('dormant imports persist across Office restarts without entering the agent queue', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run();
  f.queue.shutdown();
  let spawns = 0;
  const restored = new TaskQueue(f.dir, { defaultProvider: 'claude', list: () => [], deskOccupied: () => false, spawn: () => { spawns++; return 'must not run'; }, kill: async () => ({}) }, false, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
  t.after(() => restored.shutdown()); restored.pump();
  assert.equal(restored.state().tasks[0].status, 'planned'); assert.equal(restored.state().tasks[0].linear?.issueId, item.id); assert.equal(spawns, 0);
  assert.equal(new LinearStore(f.dir).data.links[item.id].taskId, restored.state().tasks[0].id);
});

test('stale browser revisions cannot silently overwrite newer Linear edits', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run();
  const task = f.queue.state().tasks[0], revision = task.linear!.updatedAt;
  item.title = 'Updated elsewhere'; item.updatedAt = new Date(Date.now() + 60000).toISOString();
  await assert.rejects(f.service.edit('ivan', 'floor', task.id, { title: 'Old browser edit' }, undefined, undefined, revision), /changed while/);
  assert.equal(item.title, 'Updated elsewhere'); assert.equal(f.service.store.data.outbox.length, 0);
});

test('reassignment withdraws an approved run that is still queued rather than billing the previous employee', async (t) => {
  const f = fixture(t), item = issue(); f.remote.set(item.id, item); await f.service.sync!.run();
  const task = f.queue.state().tasks[0]; f.queue.setLimit(0); f.queue.startOwn(task.id, 'ivan', 'Ivan', 'claude');
  item.assignee = { id: 'eddie-linear', name: 'Eddie' }; await f.service.sync!.run(); f.queue.setLimit(1);
  assert.equal(f.queue.state().tasks[0].status, 'planned'); assert.equal(f.workers.length, 0);
  assert.equal(f.queue.startOwn(task.id, 'eddie', 'Eddie', 'codex'), undefined); assert.equal(f.workers[0].owner, 'eddie');
});
