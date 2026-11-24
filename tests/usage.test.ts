import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger, newTracker, restoreTracker, scanTracker, trackerUsage, zeroUsage } from '../src/server/usage.js';

const assistant = (id: string, model: string, more: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 1, 12, 0, Number(id))).toISOString(), ...more, message: { id: `msg_${id}`, model, usage: { input_tokens: 10, output_tokens: 5 } } });

test('a correction to prior usage cannot make today negative or grant new budget credit', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ledger-'));
  const previous = { ...zeroUsage(), input: 500_000, cost: 1, calls: 2 };
  writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ total: previous, days: { '2000-01-01': previous } }));
  const ledger = new Ledger(dir, { budget: 0.2, pauseHiring: true }, () => {}, () => {});
  t.after(() => { ledger.flush(); rmSync(dir, { recursive: true, force: true }); });

  // Claude's cumulative cost-state can correct an estimate booked on an earlier day.
  ledger.add({ ...zeroUsage(), input: -366_195, cost: -0.56 });
  assert.deepEqual(ledger.state().today, zeroUsage());
  assert.equal(ledger.state().total.input, 133_805);
  assert.ok(Math.abs(ledger.state().total.cost - 0.44) < 1e-10, 'all-time keeps the correction');

  const spentToday = { ...zeroUsage(), input: 120, cost: 0.2, calls: 1 };
  ledger.add(spentToday);
  assert.deepEqual(ledger.state().today, spentToday, 'new spend is not offset by an earlier-day correction');
  assert.equal(ledger.overBudget, true);
  assert.match(ledger.hiringPaused!, /budget is spent/);
  ledger.flush();
  const restored = new Ledger(dir, { budget: 0.2, pauseHiring: true }, () => {}, () => {});
  t.after(() => restored.flush());
  assert.deepEqual(restored.state(), ledger.state(), 'the correction and daily floor survive restart');
});

test('same-day usage corrections still lower each counter, with zero as the lower bound', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ledger-'));
  const ledger = new Ledger(dir, { pauseHiring: false }, () => {}, () => {});
  t.after(() => { ledger.flush(); rmSync(dir, { recursive: true, force: true }); });
  ledger.add({ input: 10, output: 20, cacheWrite: 30, cacheRead: 40, cost: 2, calls: 3 });
  ledger.add({ input: -5, output: -10, cacheWrite: -15, cacheRead: -20, cost: -0.5, calls: -1 });
  assert.deepEqual(ledger.state().today, { input: 5, output: 10, cacheWrite: 15, cacheRead: 20, cost: 1.5, calls: 2 });
  assert.deepEqual(ledger.state().total, ledger.state().today);
  ledger.add({ input: -10, output: -20, cacheWrite: -30, cacheRead: -40, cost: -2, calls: -3 });
  assert.deepEqual(ledger.state().today, zeroUsage());
  assert.deepEqual(ledger.state().total, zeroUsage());
});

test('a Claude session\'s usage names the model its own latest message ran on', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session.jsonl');
  const tracker = newTracker();
  tracker.transcript = transcript;
  assert.equal(trackerUsage(tracker).model, undefined);

  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n`);
  assert.equal(scanTracker(tracker), true);
  assert.equal(trackerUsage(tracker).model, 'claude-opus-5-5');
  assert.equal(trackerUsage(tracker).calls, 1);

  // A subagent on another model, and Claude Code's own placeholder messages, don't change what the session runs on.
  const subagents = path.join(dir, 'session', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(path.join(subagents, 'agent-1.jsonl'), `${assistant('2', 'claude-haiku-4-5-20251001')}\n`);
  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n${assistant('3', '<synthetic>')}\n${assistant('4', 'claude-haiku-4-5-20251001', { isSidechain: true })}\n`);
  assert.equal(scanTracker(tracker), true);
  assert.equal(trackerUsage(tracker).model, 'claude-opus-5-5');
  assert.equal(trackerUsage(tracker).calls, 4);

  // Switched with /model: the card follows.
  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n${assistant('3', '<synthetic>')}\n${assistant('4', 'claude-haiku-4-5-20251001', { isSidechain: true })}\n${assistant('5', 'claude-sonnet-5-5')}\n`);
  scanTracker(tracker);
  assert.equal(trackerUsage(tracker).model, 'claude-sonnet-5-5');

  // And it's kept across a restart, with the rest of the tracker.
  const restored = restoreTracker(JSON.parse(JSON.stringify(tracker)));
  assert.equal(trackerUsage(restored).model, 'claude-sonnet-5-5');
  assert.equal(restoreTracker({ ...tracker, model: 'not a model\u0007' }).model, undefined);
});
