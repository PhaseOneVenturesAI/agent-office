import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ask, change, fileStore, pinFile, pinOf, readPins, writePins } from '../src/server/cubbies/local/devices.js';
import { withDeviceLock } from '../src/server/cubbies/local/device-lock.js';
import { owner, testOwnerKey } from './support/cubby-keys.js';

function directory(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cubby-device-lock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a connector waits for a separate process transaction and re-reads its revoked pins', { timeout: 5000 }, async t => {
  const state = directory(t), phone = pinOf(testOwnerKey().ownerKey, 'Phone', 1);
  writePins(state, 'floor', [pinOf(owner.ownerKey, 'Mac', 1), phone]);
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { fileStore } from ${JSON.stringify(new URL('../src/server/cubbies/local/devices.ts', import.meta.url).href)};
    fileStore(${JSON.stringify(state)}, 'floor', ${JSON.stringify(owner.ownerKey)}).update(state => {
      console.log('locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      state.pins = state.pins.filter(p => p.fingerprint !== ${JSON.stringify(phone.fingerprint)});
    });
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const exited = once(child, 'exit');
  const [ready] = await once(child.stdout!, 'data');
  assert.match(ready.toString(), /locked/);
  const store = fileStore(state, 'floor', owner.ownerKey);
  ask(store, { requestId: 'waiting', key: testOwnerKey().ownerKey, label: 'Tablet' }, Date.now());
  assert.deepEqual(readPins(state, 'floor')!.map(p => p.key), [owner.ownerKey]);
  assert.equal(store.waiting().length, 1);
  assert.equal((await exited)[0], 0);
});

test('device locks recover dead and incomplete owners, bound live contention, and release after errors', t => {
  const state = directory(t), file = pinFile(state, 'floor'), lock = `${file}.lock`;
  const deadPid = Number(execFileSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }));
  writeFileSync(lock, JSON.stringify({ pid: deadPid }));
  withDeviceLock(file, () => assert.equal(statSync(lock).mode & 0o777, 0o600));
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, '');
  utimesSync(lock, new Date(0), new Date(0));
  withDeviceLock(file, () => {});
  assert.equal(existsSync(lock), false);
  withDeviceLock(file, () => {
    // An old mtime never permits stealing from a live process.
    utimesSync(lock, new Date(0), new Date(0));
    const start = performance.now();
    assert.throws(() => withDeviceLock(file, () => assert.fail('stole live lock')), /busy/);
    assert.ok(performance.now() - start < 3000, 'contention has a short bounded wait');
    assert.equal(existsSync(lock), true);
  });
  assert.throws(() => withDeviceLock(file, () => { throw Error('edit failed'); }), /edit failed/);
  assert.equal(existsSync(lock), false);
  withDeviceLock(file, () => {});
});

test('a device change checks the signer against the pins read inside its transaction', t => {
  const state = directory(t), phone = pinOf(testOwnerKey().ownerKey, 'Phone', 1), tablet = testOwnerKey();
  writePins(state, 'floor', [pinOf(owner.ownerKey, 'Mac', 1), phone]);
  const store = fileStore(state, 'floor', owner.ownerKey), stalePins = store.pins();
  ask(store, { requestId: 'tablet', key: tablet.ownerKey, label: 'Tablet' }, Date.now());
  change(fileStore(state, 'floor', owner.ownerKey), 'revoke', phone.fingerprint, Date.now());
  store.pins = () => stalePins;
  assert.match(change(store, 'add', tablet.ownerKey, Date.now(), key => key === phone.key).error!, /wasn’t signed/);
  assert.deepEqual(readPins(state, 'floor')!.map(p => p.key), [owner.ownerKey]);
  assert.equal(store.waiting().length, 1);
});
