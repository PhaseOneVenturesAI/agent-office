import test from 'node:test';
import assert from 'node:assert/strict';
import { alertsForMe } from '../src/client/notify.js';
import type { Me, WorkerInfo } from '../src/shared/protocol.js';

function worker(more: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id: 'w1', kind: 'agent', deskId: 'desk-1', name: 'Byte', color: '#fff', status: 'needs_input', acked: false, createdBy: 'Ada', createdAt: 0, cols: 80, rows: 24, viewers: [], ...more };
}

const ada: Me = { account: { id: 'acc-ada', name: 'Ada', role: 'member' }, admin: false };
const grace: Me = { account: { id: 'acc-grace', name: 'Grace', role: 'member' }, admin: false };
const admin: Me = { account: { id: 'acc-boss', name: 'Boss', role: 'admin' }, admin: true };
const guest: Me = { admin: true }; // the shared office password, no accounts

test('the hirer gets alerted about their own worker, nobody else does', () => {
  const mine = worker({ owner: 'acc-ada' });
  assert.equal(alertsForMe(mine, ada), true);
  assert.equal(alertsForMe(mine, grace), false);
  // My name in createdBy is not enough: the account id is what counts (renames don't break it).
  assert.equal(alertsForMe(worker({ createdBy: 'Ada', owner: 'acc-grace' }), ada), false);
});

test('a worker with no owner on file (legacy, office-owned, or hired on the shared password) alerts the admins', () => {
  const legacy = worker({ createdBy: '?' }); // restored from before createdBy was saved
  const guests = worker({ createdBy: 'Someone' }); // hired by a shared-password guest
  for (const w of [legacy, guests]) {
    assert.equal(alertsForMe(w, admin), true);
    assert.equal(alertsForMe(w, ada), false);
  }
});

test('with no accounts at all, everyone still hears about every worker', () => {
  assert.equal(alertsForMe(worker({ owner: 'acc-ada' }), guest), true);
  assert.equal(alertsForMe(worker({ createdBy: '?' }), guest), true);
});
