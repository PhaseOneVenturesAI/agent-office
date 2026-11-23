// The floor's CEO (see src/server/ceo.ts): one persistent identity per project — naming, the
// saved engine, the shift launch (resumed, never duplicated), swap relink, and persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FloorCeo } from '../src/server/ceo.js';

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-ceo-'));
  const dataDir = path.join(base, 'data');
  mkdirSync(dataDir, { recursive: true });
  const ceo = new FloorCeo(dataDir, () => {});
  return { base, dataDir, ceo, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a CEO is named with a saved engine, replaced only off shift, and retires cleanly', () => {
  const { ceo, cleanup } = setup();
  try {
    assert.match(ceo.set({ name: '  ' }, 'Kim')!, /Give the CEO a name/);
    assert.equal(ceo.set({ name: 'Avery', provider: 'kimi', model: 'kimi-code/kimi-for-coding' }, 'Kim'), undefined);
    assert.equal(ceo.get()!.name, 'Avery');
    assert.equal(ceo.savedChoice()!.provider, 'kimi');
    // While their worker is live, the identity can't be replaced under it.
    ceo.recordHire('w1', 'Kim');
    assert.match(ceo.set({ name: 'Sam' }, 'Kim')!, /on shift/);
    // But an engine refresh keeps the live link — losing it would allow a duplicate shift.
    assert.equal(ceo.set({ name: 'Avery', provider: 'codex' }, 'Kim'), undefined);
    assert.equal(ceo.get()!.workerId, 'w1', 'the engine refresh preserves the live link');
    assert.match(ceo.composeLaunch(undefined, () => ['w1']) as string, /already on shift/);
    assert.equal(ceo.clear(), undefined);
    assert.equal(ceo.get(), undefined);
  } finally {
    cleanup();
  }
});

test('the shift composes a director prompt, refuses a duplicate while live, resumes a stale identity', () => {
  const { ceo, cleanup } = setup();
  try {
    assert.match(ceo.composeLaunch(undefined, () => []) as string, /Name a CEO first/);
    ceo.set({ name: 'Avery' }, 'Kim');
    const composed = ceo.composeLaunch('first: survey the floors', () => []);
    assert.ok(typeof composed !== 'string');
    assert.match(composed.prompt, /You are Avery, the CEO of this project floor\./);
    assert.match(composed.prompt, /You direct the department managers/);
    assert.match(composed.prompt, /office-workers assign --dept/);
    assert.match(composed.prompt, /never hire or delegate workers yourself/);
    assert.match(composed.prompt, /First objective: first: survey the floors/);
    // Not a writer: two writers live and the shift still composes.
    ceo.recordHire('ceo-1', 'Kim');
    assert.match(ceo.composeLaunch(undefined, () => ['w1', 'w2', 'ceo-1']) as string, /already on shift/);
    const resumed = ceo.composeLaunch(undefined, () => ['w1', 'w2']);
    assert.ok(typeof resumed !== 'string');
    assert.equal(ceo.get()!.workerId, undefined, 'the stale link is cleared for a fresh shift');
  } finally {
    cleanup();
  }
});

test('the identity survives a reload; a landed swap moves it; ownership checks hold', () => {
  const { dataDir, ceo, cleanup } = setup();
  try {
    ceo.set({ name: 'Avery', provider: 'codex' }, 'Kim');
    ceo.recordHire('old-ceo', 'Kim');
    const reloaded = new FloorCeo(dataDir, () => {});
    assert.equal(reloaded.get()!.name, 'Avery');
    assert.equal(reloaded.get()!.workerId, 'old-ceo');
    assert.equal(reloaded.get()!.provider, 'codex');
    assert.ok(reloaded.isCeoWorker('old-ceo'));
    assert.ok(!reloaded.isCeoWorker('someone-else'));
    reloaded.relinkWorker('old-ceo', 'new-ceo');
    assert.equal(reloaded.get()!.workerId, 'new-ceo');
    assert.ok(reloaded.isCeoWorker('new-ceo'));
    // A relink that isn't the CEO touches nothing.
    reloaded.relinkWorker('nobody', 'anybody');
    assert.equal(reloaded.get()!.workerId, 'new-ceo');
  } finally {
    cleanup();
  }
});
