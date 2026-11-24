import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoleHomes } from '../src/server/role-homes.js';
import { rolePresence, rolePresenceHandlers } from '../src/server/ws/handlers/role-presence.js';
import type { Floor } from '../src/server/floor.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

test('display homes seed real seats, survive restart and occupancy, and never reserve capacity', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'role-homes-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const roles = [{ key: 'ceo', workerDesk: 'desk-3' }, { key: 'manager:dev', desks: ['desk-1'] }, { key: 'manager:review' }];
  const built = ['desk-1', 'desk-2', 'desk-3'];
  const homes = new RoleHomes(dir).resolve(roles, built, () => false);
  assert.deepEqual(homes, { ceo: 'desk-3', 'manager:dev': 'desk-1', 'manager:review': 'desk-2' });
  const before = readFileSync(path.join(dir, 'role-homes.json'), 'utf8');
  assert.deepEqual(new RoleHomes(dir).resolve(roles.map(r => ({ key: r.key })), built, () => true), homes);
  assert.equal(readFileSync(path.join(dir, 'role-homes.json'), 'utf8'), before);
  assert.deepEqual(new RoleHomes(dir).resolve([{ key: 'ceo', workerDesk: 'desk-2' }], built, () => false), { ceo: 'desk-3' });
});

test('invalid home records are preserved; failed persistence never publishes a proposed home', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'role-homes-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'role-homes.json'); writeFileSync(file, 'damaged');
  assert.match(String(new RoleHomes(dir).resolve([{ key: 'ceo' }], ['desk-1'], () => false)), /preserved/);
  assert.equal(readFileSync(file, 'utf8'), 'damaged');
  const blocked = path.join(dir, 'blocked'); writeFileSync(blocked, 'not a directory');
  assert.match(String(new RoleHomes(blocked).resolve([{ key: 'ceo' }], ['desk-1'], () => false)), /could not be loaded/);
  rmSync(file); const writable = new RoleHomes(dir); mkdirSync(file);
  assert.match(String(writable.resolve([{ key: 'ceo' }], ['desk-1'], () => false)), /no home was changed/);
  rmSync(file, { recursive: true });
  assert.deepEqual(writable.resolve([{ key: 'ceo' }], ['desk-2'], () => false), { ceo: 'desk-2' });
});

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'role-access-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ceo = { name: 'Avery', owner: 'owner@test.local', workerId: 'ceo-worker' as string | undefined };
  const dept = { id: 'dev', name: 'Product', desks: ['desk-2'], lead: { name: 'Maya', workerId: 'manager-worker' as string | undefined, controllers: ['controller@test.local'], audience: ['staff@test.local'], custodian: undefined } };
  const workers = new Map([
    ['ceo-worker', { id: 'ceo-worker', deskId: 'desk-1', provider: 'kimi', owner: 'owner@test.local', task: { summary: 'private objective' } }],
    ['manager-worker', { id: 'manager-worker', deskId: 'desk-2', provider: 'kimi', owner: 'controller@test.local', task: { summary: 'private plan' } }],
  ]);
  const floor = {
    id: 'floor', dataDir: dir, plan: { wing: 0 }, ceo: { get: () => ceo },
    departments: { state: () => ({ departments: [dept] }), get: (id: string) => id === 'dev' ? dept : undefined, leadDeptOfWorker: (id: string) => id === dept.lead.workerId ? dept : undefined },
    workers: { get: (id: string) => workers.get(id), list: () => [...workers.values()], deskOccupied: (id: string) => [...workers.values()].some(w => w.deskId === id), ownerOf: (id: string) => workers.get(id)?.owner, officeDefault: { provider: 'kimi' } },
  } as unknown as Floor;
  const sent: unknown[] = [];
  const ctx = {
    accounts: { any: true, get: (id: string) => ({ id, email: id }), byEmail: () => undefined },
    signins: { officeRevoked: () => false, officeAllowed: () => false },
    meOf: () => ({ admin: true }), floorOf: () => floor,
    sendTo: (_c: unknown, msg: unknown) => sent.push(msg), warn: () => assert.fail('unexpected warning'),
  } as unknown as Ctx;
  return { ctx, floor, ceo, dept, workers, sent };
}

test('character actions retain private CEO, audience and separate runtime custody boundaries', t => {
  const f = fixture(t);
  const owner = rolePresence(f.ctx, f.floor, 'owner@test.local').roles;
  assert.equal(owner.find(r => r.key === 'ceo')?.talk, true);
  const staff = rolePresence(f.ctx, f.floor, 'staff@test.local').roles;
  assert.deepEqual(staff.map(r => [r.key, r.talk, r.start, r.ask]), [['ceo', false, false, false], ['manager:dev', false, false, true]]);
  const stranger = rolePresence(f.ctx, f.floor, 'other-admin@test.local').roles;
  assert.ok(stranger.every(r => !r.talk && !r.start && !r.ask));
  assert.equal(JSON.stringify(staff).includes('private objective'), false);
  assert.equal(JSON.stringify(staff).includes('private plan'), false);
  assert.equal(JSON.stringify(staff).includes('owner@test.local'), false);
  assert.equal(rolePresence(f.ctx, f.floor, 'controller@test.local').roles[1].talk, true);
  f.workers.get('manager-worker')!.owner = 'someone-else@test.local';
  assert.equal(rolePresence(f.ctx, f.floor, 'controller@test.local').roles[1].talk, false);
  f.workers.clear();
  const offShift = rolePresence(f.ctx, f.floor, 'owner@test.local').roles;
  assert.equal(offShift[0].start, true);
  assert.equal(offShift[1].start, false, 'manager launch still needs explicit custodian consent');
  assert.ok(offShift.every(r => !r.workerId));
  assert.equal(f.workers.size, 0, 'display homes never create runtime workers');
});

test('presence handler returns only current floor and correlates the viewer request', t => {
  const f = fixture(t);
  rolePresenceHandlers['role.presence.get'](f.ctx, { accountId: 'staff@test.local' } as Client, { t: 'role.presence.get', requestId: 'request' });
  assert.equal(f.sent.length, 1);
  assert.equal((f.sent[0] as { floor: string }).floor, 'floor');
  assert.equal((f.sent[0] as { requestId: string }).requestId, 'request');
});

test('configured CEO ownership is resolved on the server without exposing it in character metadata', t => {
  const f = fixture(t), previous = process.env.AGENT_OFFICE_CEO_OWNER;
  t.after(() => { if (previous === undefined) delete process.env.AGENT_OFFICE_CEO_OWNER; else process.env.AGENT_OFFICE_CEO_OWNER = previous; });
  process.env.AGENT_OFFICE_CEO_OWNER = 'owner@test.local';
  delete (f.ceo as { owner?: string }).owner;
  assert.equal(rolePresence(f.ctx, f.floor, 'owner@test.local').roles[0].talk, true);
  const other = rolePresence(f.ctx, f.floor, 'other-admin@test.local').roles[0];
  assert.equal(other.talk, false); assert.equal(other.start, false);
  assert.equal(JSON.stringify(other).includes('owner@test.local'), false);
});

test('broken display-home storage is reported without denying an existing authorized conversation', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.floor.dataDir, 'role-homes.json'), 'damaged');
  const result = rolePresence(f.ctx, f.floor, 'owner@test.local');
  assert.match(result.error!, /preserved/);
  assert.equal(result.roles[0].talk, true);
  assert.equal(result.roles[0].deskId, 'desk-1');
  assert.equal(readFileSync(path.join(f.floor.dataDir, 'role-homes.json'), 'utf8'), 'damaged');
});
