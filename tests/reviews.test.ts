// The Review Room: staging, verdicts, scoped evidence without global instruction changes, and persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Reviews, reviewUrl } from '../src/server/reviews.js';

function setup(): { dataDir: string; root: string; reviews: Reviews; changes: number; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-reviews-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  mkdirSync(root, { recursive: true });
  let changes = 0;
  const reviews = new Reviews(dataDir, () => changes++);
  return { dataDir, root, reviews, changes: 0, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('only http(s) links stage, and a title is required', () => {
  const { reviews, cleanup } = setup();
  try {
    assert.equal(reviewUrl('https://stage.example.com/hero'), undefined);
    assert.ok(reviewUrl('file:///etc/passwd'));
    assert.ok(reviewUrl('javascript:alert(1)'));
    assert.ok(reviewUrl('not a url'));
    assert.equal(typeof reviews.submit({ title: '', url: 'https://x.example.com', by: 'Kim' }), 'string');
    assert.equal(typeof reviews.submit({ title: 'Hero', url: 'ftp://x', by: 'Kim' }), 'string');
    const item = reviews.submit({ title: 'Hero v3', url: 'https://stage.example.com/hero', note: 'first take', gate: 'passed', by: 'Kim' });
    assert.ok(typeof item !== 'string');
    assert.equal(item.status, 'pending');
    assert.equal(reviews.state().pending, 1);
  } finally {
    cleanup();
  }
});

test('verdicts persist with their originating project and notify only their worker, without global rules', () => {
  const { dataDir, root, reviews, cleanup } = setup();
  try {
    const instructions = '# Shared defaults\n<!-- review-ratchet:start -->\n- old feedback\n<!-- review-ratchet:end -->\nKeep instructions after the old block.\n';
    writeFileSync(path.join(root, 'CLAUDE.md'), instructions);
    const bad = reviews.submit({ title: 'Cheap gradient hero', url: 'https://s.example.com/a', by: 'Kim', workerId: 'w1', floorId: 'f1' });
    const good = reviews.submit({ title: 'Flat brand hero', url: 'https://s.example.com/b', by: 'Kim' });
    assert.ok(typeof bad !== 'string' && typeof good !== 'string');

    assert.equal(typeof reviews.resolve(bad.id, false, '', 'Jonathan'), 'string', 'rejecting without a reason is refused');

    const r1 = reviews.resolve(bad.id, false, 'gradients feel cheap — flat brand color only', 'Jonathan');
    assert.ok(typeof r1 !== 'string');
    assert.equal(r1.item.status, 'rejected');
    assert.ok(r1.prompt?.includes('REJECTED') && r1.prompt.includes('gradients feel cheap'), 'the worker hears the verdict and the reason');

    const r2 = reviews.resolve(good.id, true, '', 'Jonathan');
    assert.ok(typeof r2 !== 'string');
    assert.equal(r2.item.status, 'accepted');
    assert.equal(r2.prompt, undefined, 'no worker to tell');

    // Deciding twice is refused.
    assert.equal(typeof reviews.resolve(good.id, true, '', 'Jonathan'), 'string');

    assert.equal(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), instructions, 'legacy evidence and instructions remain byte-for-byte unchanged');
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'reviews.json'), 'utf8'));
    const rejected = saved.find((i: { id: string }) => i.id === bad.id);
    assert.equal(rejected.floorId, 'f1');
    assert.equal(rejected.workerId, 'w1');
    assert.equal(rejected.verdict.reason, 'gradients feel cheap — flat brand color only');
  } finally {
    cleanup();
  }
});

test('the board is bounded but all historical decisions survive later saves and restarts', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-reviews-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  mkdirSync(root, { recursive: true });
  try {
    const first = new Reviews(dataDir, () => {});
    for (let i = 0; i < 60; i++) {
      const item = first.submit({ title: `Take ${i}`, url: `https://s.example.com/${i}`, by: 'Kim' });
      assert.ok(typeof item !== 'string');
      first.resolve(item.id, i % 2 === 0, i % 2 === 0 ? '' : `reason ${i}`, 'Jonathan');
    }
    first.submit({ title: 'Still waiting', url: 'https://s.example.com/wait', by: 'Kim' });
    const second = new Reviews(dataDir, () => {});
    const state = second.state();
    assert.equal(state.pending, 1, 'the pending one survives');
    assert.equal(state.items.filter((i) => i.status !== 'pending').length, 50, 'resolved capped');
    assert.equal(state.items[0].title, 'Still waiting', 'newest first');
    second.submit({ title: 'Another project', url: 'https://other.example.com/v1', by: 'Alex', floorId: 'other' });
    const saved = JSON.parse(readFileSync(path.join(dataDir, 'reviews.json'), 'utf8'));
    assert.equal(saved.length, 62, 'no history is pruned when a new item is saved');
    assert.ok(saved.some((i: { title: string }) => i.title === 'Take 0'), 'oldest decision remains');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});


test('a persistence failure does not acknowledge a verdict or change the pending item', () => {
  const { dataDir, reviews, cleanup } = setup();
  try {
    const item = reviews.submit({ title: 'A take', url: 'https://stage.example.com/v1', by: 'Kim', workerId: 'w1' });
    assert.ok(typeof item !== 'string');
    rmSync(path.join(dataDir, 'reviews.json'));
    mkdirSync(path.join(dataDir, 'reviews.json'));
    const result = reviews.resolve(item.id, true, 'good', 'Jonathan');
    assert.equal(typeof result, 'string');
    assert.match(result as string, /Couldn't save/);
    assert.equal(reviews.state().items[0].status, 'pending');
    assert.equal(reviews.state().items[0].verdict, undefined);
  } finally {
    cleanup();
  }
});

test('unreadable historical data is never replaced with an empty new board', () => {
  const { dataDir, cleanup } = setup();
  try {
    mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'reviews.json');
    writeFileSync(file, 'damaged history to recover');
    const reviews = new Reviews(dataDir, () => {});
    const result = reviews.submit({ title: 'New', url: 'https://stage.example.com/new', by: 'Kim' });
    assert.equal(typeof result, 'string');
    assert.equal(readFileSync(file, 'utf8'), 'damaged history to recover');
  } finally {
    cleanup();
  }
});
