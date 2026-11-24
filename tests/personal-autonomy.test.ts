import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersonalAutonomy } from '../src/server/personal-autonomy/store.js';
import { applyPersonalAutonomy, personalAutonomyState, personalWorkerScope } from '../src/server/personal-autonomy/service.js';
import { savePersonalAutonomy, personalAutonomyHandlers } from '../src/server/ws/handlers/personal-autonomy.js';
import { applyWorkerAutonomy, autonomyChoice, refreshPersonalAutonomy } from '../src/server/workers/autonomy.js';
import { subscriptionScope } from '../src/server/role-subscriptions/access.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { Worker } from '../src/server/workers/types.js';
const ALICE = 'a'.repeat(16), BOB = 'b'.repeat(16);

test('account preference persists separately, refuses unreadable/symlink state, and rolls back failed writes', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'own-autonomy-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new PersonalAutonomy(dir); assert.equal(store.mode(ALICE), undefined);
  assert.equal(store.set(ALICE, true), undefined); assert.equal(store.set(BOB, false), undefined);
  const restored = new PersonalAutonomy(dir); assert.equal(restored.mode(ALICE), 'autonomous'); assert.equal(restored.mode(BOB), 'supervised');
  writeFileSync(path.join(dir, 'personal-autonomy.json'), 'bad state');
  assert.match(new PersonalAutonomy(dir).set(ALICE, false)!, /could not be read/); assert.equal(readFileSync(path.join(dir, 'personal-autonomy.json'), 'utf8'), 'bad state');
  rmSync(path.join(dir, 'personal-autonomy.json')); symlinkSync('other.json', path.join(dir, 'personal-autonomy.json'));
  assert.match(new PersonalAutonomy(dir).set(ALICE, true)!, /could not be read/);
  const missing = new PersonalAutonomy(path.join(dir, 'missing')); assert.match(missing.set(ALICE, true)!, /could not be saved/); assert.equal(missing.mode(ALICE), undefined);
});

test('future workers use their own account default; explicit role choices, shells and staff Q&A remain separate', () => {
  const runAs = { autonomy: (id: string) => id === ALICE ? 'autonomous' as const : 'supervised' as const } as any;
  assert.deepEqual(autonomyChoice(undefined, 'agent', ALICE, 'claude', runAs), { autonomyRequested: 'autonomous', autonomySource: 'account' });
  assert.equal(autonomyChoice(undefined, 'agent', BOB, 'kimi', runAs).autonomyRequested, 'supervised');
  assert.deepEqual(autonomyChoice('supervised', 'agent', ALICE, 'kimi', runAs), { autonomyRequested: 'supervised', autonomySource: 'explicit' });
  assert.equal(autonomyChoice(undefined, 'shell', ALICE, 'claude', runAs).autonomyRequested, undefined);
  assert.equal(autonomyChoice(undefined, 'agent', undefined, 'kimi', runAs).autonomyRequested, undefined);
  const worker = { kind: 'agent', provider: 'claude', autonomyRequested: 'supervised', autonomySource: 'account' } as WorkerInfo;
  refreshPersonalAutonomy(worker, ALICE, runAs); assert.equal(worker.autonomyRequested, 'autonomous');
  worker.autonomySource = 'explicit'; worker.autonomyRequested = 'supervised'; refreshPersonalAutonomy(worker, ALICE, runAs); assert.equal(worker.autonomyRequested, 'supervised');
});

function fixture(dir: string) {
  const accounts = [{ id: ALICE, email: 'alice@example.test' }, { id: BOB, email: 'bob@example.test' }];
  const items = new Map<string, any>(); const grants = new Map<string, any>(); const changed: { id: string; mode: string; source: string }[] = []; const sent: any[] = [];
  const roles: any[] = [
    { id: 'own', name: 'Marketing', lead: { workerId: 'manager', custodian: accounts[0].email, controllers: [accounts[0].email], audience: [], provider: 'kimi', autonomy: 'supervised', autonomyConfirmed: true } },
    { id: 'other', name: 'Development', lead: { workerId: 'other-manager', custodian: accounts[1].email, controllers: [accounts[0].email], audience: [], provider: 'kimi' } },
  ];
  const floor: any = { id: 'floor', project: { name: 'Project' }, ceo: { get: () => ({ owner: accounts[0].email }) }, roleChat: { privacy: new Map() },
    departments: { get: (id: string) => roles.find(d => d.id === id), leadDeptOfWorker: (id: string) => roles.find(d => d.lead.workerId === id) },
    queue: { state: () => ({ tasks: [{ workerId: 'child', parentId: 'manager', dept: 'own', owner: ALICE }, { workerId: 'personal-child', parentId: 'other-manager', dept: 'other', owner: ALICE }] }) },
    workers: { list: () => [...items.values()], ownerOf: (id: string) => items.get(id)?.owner, get: (id: string) => items.get(id), officeDefault: { provider: 'kimi' }, autonomyDetails: () => ({ pendingApproval: false }),
      applyAutonomy: async (id: string, mode: string, source: string) => { changed.push({ id, mode, source }); Object.assign(items.get(id), { autonomyRequested: mode, autonomySource: source }); },
    },
  };
  const ctx: any = { personalAutonomy: new PersonalAutonomy(dir), floors: new Map([['floor', floor]]), clients: new Map(), sendTo: (_: any, msg: any) => sent.push(msg),
    accounts: { any: true, get: (id: string) => accounts.find(a => a.id === id), byEmail: (email: string) => accounts.find(a => a.email === email) },
    signins: { state: () => ({ claude: { how: 'login' }, codex: { how: 'login' }, kimi: { how: 'login' } }), ready: () => true, officeRevoked: () => false },
    roleSubscriptions: { get: (_floor: string, id: string) => grants.get(id) },
  };
  for (const [id, owner] of [['personal', ALICE], ['personal-child', ALICE], ['coworker', BOB], ['manager', ALICE], ['other-manager', BOB], ['child', ALICE], ['stale-custodian', ALICE]]) items.set(id, { id, name: id, kind: 'agent', provider: 'kimi', owner, status: 'working' });
  floor.roleChat.privacy.set('stale-custodian', { kind: 'manager', department: 'other' });
  for (const dept of roles) {
    const scope = subscriptionScope(ctx, floor, dept.id, 'kimi');
    grants.set(dept.id, { configuration: scope.configuration, custodian: scope.custodian!.id, provider: 'kimi', controllers: [ALICE], allowWorkers: true });
  }
  return { ctx, floor, roles, changed, sent, items, grants };
}
test('the sender changes only own personal/custodied workers; explicit roles and changed custody stay intact', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'own-autonomy-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { ctx, floor, changed, sent, items, roles } = fixture(dir);
  await savePersonalAutonomy(ctx, { accountId: ALICE } as any, { t: 'personal.autonomy.set', requestId: 'one', automatic: true });
  assert.deepEqual(changed.map(c => c.id).sort(), ['child', 'personal', 'personal-child']); assert.equal(ctx.personalAutonomy.mode(BOB), undefined);
  assert.equal(roles[0].lead.autonomy, 'supervised'); assert.equal(personalAutonomyState(ctx, ALICE).workers.find(w => w.id === 'manager')?.status, 'override');
  assert.equal(personalWorkerScope(ctx, floor, items.get('coworker'), ALICE), undefined);
  assert.match(personalWorkerScope(ctx, floor, items.get('stale-custodian'), ALICE)!.why!, /custodian/);
  assert.ok(!sent.at(-1).state.workers.some((w: any) => ['coworker', 'other-manager'].includes(w.id)));
  changed.length = 0;
  await savePersonalAutonomy(ctx, { accountId: ALICE } as any, { t: 'personal.autonomy.set', requestId: 'bad', automatic: false, accountId: BOB } as any);
  assert.equal(changed.length, 0); assert.equal(ctx.personalAutonomy.mode(ALICE), 'autonomous'); assert.ok(sent.at(-1).error);
  await savePersonalAutonomy(ctx, { accountId: BOB, out: true } as any, { t: 'personal.autonomy.set', requestId: 'gone', automatic: true });
  assert.equal(ctx.personalAutonomy.mode(BOB), undefined);
  personalAutonomyHandlers['personal.autonomy.get'](ctx, { accountId: BOB } as any, { t: 'personal.autonomy.get' });
  assert.ok(sent.at(-1).state.workers.every((w: any) => !['personal', 'manager', 'child'].includes(w.id)));
});

test('personal change waits for persistence, does not restart native work, and keeps failed ACK pending', async () => {
  let called = 0, durable = false;
  const info = { id: 'w', kind: 'agent', provider: 'kimi', autonomyRequested: 'supervised', autonomyApplied: { mode: 'supervised', provider: 'kimi', acknowledged: true, detail: 'manual' } } as WorkerInfo;
  const w = { info, dsh: { setAutonomy: async () => { called++; return { applied: false, detail: 'Native ACK failed' }; } } } as unknown as Worker;
  const ctx = { workers: new Map([['w', w]]), persist: () => durable, emit() {} };
  assert.match((await applyWorkerAutonomy(ctx, 'w', 'autonomous'))!, /could not be saved/); assert.equal(called, 0); assert.equal(info.autonomyRequested, 'supervised');
  durable = true; assert.equal(await applyWorkerAutonomy(ctx, 'w', 'autonomous'), 'Native ACK failed'); assert.equal(info.autonomyApplied?.mode, 'supervised'); assert.equal(info.autonomyRequested, 'autonomous');
  for (const provider of ['claude', 'codex'] as const) { info.provider = provider; await applyWorkerAutonomy(ctx, 'w', 'autonomous'); }
  assert.equal(called, 1, 'native sessions were not restarted or sent a mode command');
});

test('status distinguishes live ACK, next launch, offline history and authoritative matching role settings', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'own-autonomy-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { ctx, items, roles, changed } = fixture(dir);
  ctx.personalAutonomy.set(ALICE, true);
  const worker = items.get('personal');
  worker.autonomyApplied = { mode: 'autonomous', provider: 'kimi', acknowledged: true, detail: 'Kimi acknowledged automatic review' };
  const row = () => personalAutonomyState(ctx, ALICE).workers.find(w => w.id === 'personal')!;
  assert.equal(row().status, 'applied');
  worker.status = 'offline'; assert.equal(row().status, 'pending'); assert.match(row().detail, /no active process/);
  worker.status = 'working'; worker.autonomyApplied.acknowledged = false; assert.equal(row().status, 'launch');
  worker.autonomyError = 'No native acknowledgement'; assert.equal(row().status, 'pending');
  roles[0].lead.autonomy = 'autonomous';
  await applyPersonalAutonomy(ctx, ALICE, 'autonomous');
  assert.deepEqual(changed.find(c => c.id === 'manager'), { id: 'manager', mode: 'autonomous', source: 'explicit' });
  assert.equal(roles[0].lead.autonomyConfirmed, true);
});
