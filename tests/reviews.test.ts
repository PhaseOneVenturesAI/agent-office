// The Review Room: staging, verdicts, the ratchet block in the harness, and persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Reviews, ratchetAppend, reviewUrl } from '../src/server/reviews.js';

function setup(): { dataDir: string; root: string; reviews: Reviews; changes: number; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-reviews-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  mkdirSync(root, { recursive: true });
  let changes = 0;
  const reviews = new Reviews(dataDir, root, () => changes++);
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

test('a rejection needs a reason; both verdicts land on the board and in the ratchet', () => {
  const { root, reviews, cleanup } = setup();
  try {
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

    const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.includes('<!-- review-ratchet:start -->'));
    assert.ok(claude.includes('❌ “Cheap gradient hero” (https://s.example.com/a) — gradients feel cheap — flat brand color only (Jonathan)'));
    assert.ok(claude.includes('✅ “Flat brand hero”'), 'accepts teach too');
    assert.ok(claude.indexOf('✅ “Flat brand hero”') < claude.indexOf('❌ “Cheap gradient hero”'), 'newest first');
  } finally {
    cleanup();
  }
});

test('the ratchet block joins an existing CLAUDE.md without eating it, and stays capped', () => {
  const { root, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# Taste lock\n\nFlat colors. Real product shots.\n');
    for (let i = 0; i < 40; i++) {
      const err = ratchetAppend(root, `- 2026-11-22 — ❌ “Take ${i}” (https://s.example.com/${i}) — reason ${i} (Jonathan)`);
      assert.equal(err, undefined);
    }
    const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.startsWith('# Taste lock\n\nFlat colors. Real product shots.'), 'what was there stays, above the block');
    const lines = claude.split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 30, 'capped at the newest 30');
    assert.ok(lines[0].includes('Take 39'), 'newest first');
    assert.equal(claude.indexOf('<!-- review-ratchet:start -->'), claude.lastIndexOf('<!-- review-ratchet:start -->'), 'one block only');
  } finally {
    cleanup();
  }
});

test('the board survives a restart, with resolved items capped', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-reviews-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  mkdirSync(root, { recursive: true });
  try {
    const first = new Reviews(dataDir, root, () => {});
    for (let i = 0; i < 60; i++) {
      const item = first.submit({ title: `Take ${i}`, url: `https://s.example.com/${i}`, by: 'Kim' });
      assert.ok(typeof item !== 'string');
      first.resolve(item.id, i % 2 === 0, i % 2 === 0 ? '' : `reason ${i}`, 'Jonathan');
    }
    first.submit({ title: 'Still waiting', url: 'https://s.example.com/wait', by: 'Kim' });
    const second = new Reviews(dataDir, root, () => {});
    const state = second.state();
    assert.equal(state.pending, 1, 'the pending one survives');
    assert.equal(state.items.filter((i) => i.status !== 'pending').length, 50, 'resolved capped');
    assert.equal(state.items[0].title, 'Still waiting', 'newest first');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
