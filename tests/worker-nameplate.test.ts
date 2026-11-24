import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nameplateText, nameplateRoleForWorker, updateWorkerNameplate } from '../src/client/world/character/worker-nameplate.js';

test('role labels are explicit without repeating role-only names', () => {
  assert.deepEqual(nameplateText('Avery', { kind: 'ceo' }), { name: 'Avery', title: 'CEO', crown: true });
  assert.deepEqual(nameplateText('CEO', { kind: 'ceo' }), { name: 'CEO', crown: true });
  assert.deepEqual(nameplateText('MarketingManager', { kind: 'manager', department: 'Marketing' }), { name: 'Marketing Manager', crown: false });
  assert.deepEqual(nameplateText('Maya', { kind: 'manager', department: 'Development' }), { name: 'Maya', title: 'Development Manager', crown: false });
  assert.deepEqual(nameplateText('Regular worker'), { name: 'Regular worker', crown: false });
});

test('role lookup follows current runtime IDs across swaps and clears previous role tags', () => {
  const departments = [{ name: 'Marketing', lead: { workerId: 'new-manager' } }];
  assert.deepEqual(nameplateRoleForWorker('new-ceo', { workerId: 'new-ceo' }, departments), { kind: 'ceo' });
  assert.deepEqual(nameplateRoleForWorker('new-manager', undefined, departments), { kind: 'manager', department: 'Marketing' });
  for (const id of ['old-ceo', 'old-manager', 'ordinary']) assert.equal(nameplateRoleForWorker(id, { workerId: 'new-ceo' }, departments), undefined);
});

test('unchanged labels reuse the same canvas, sprite and texture; role/name changes dispose exactly once', () => {
  let canvases = 0;
  const original = globalThis.document;
  const ctx = { font: '', measureText: (s: string) => ({ width: [...s].length * 17 }), beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {}, moveTo() {}, lineTo() {}, closePath() {} };
  globalThis.document = { createElement: () => { canvases++; return { width: 0, height: 0, getContext: () => ctx }; } } as unknown as Document;
  try {
    const root = new THREE.Group();
    const sprite = updateWorkerNameplate(root, null, 'Maya', { kind: 'manager', department: 'Development' });
    let disposed = 0;
    sprite.material.map!.addEventListener('dispose', () => disposed++);
    for (let n = 0; n < 100; n++) assert.equal(updateWorkerNameplate(root, sprite, 'Maya', { kind: 'manager', department: 'Development' }), sprite);
    assert.equal(canvases, 1); assert.equal(disposed, 0); assert.equal(root.children.length, 1);
    const renamed = updateWorkerNameplate(root, sprite, 'Priya', { kind: 'manager', department: 'Marketing' });
    assert.equal(canvases, 2); assert.equal(disposed, 1); assert.equal(root.children.length, 1);
    const worker = updateWorkerNameplate(root, renamed, 'Priya');
    assert.equal(worker.userData.nameplate.role, 'worker'); assert.equal(root.children.length, 1);
    assert.equal(updateWorkerNameplate(root, worker, 'Priya'), worker);
    worker.material.map!.dispose(); worker.material.dispose();
  } finally { globalThis.document = original; }
});
