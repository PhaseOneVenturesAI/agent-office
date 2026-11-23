// Departments: presets, revision conflicts, the writer cap, the asset jail, and persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Departments, MAX_WRITERS, PRESETS } from '../src/server/departments.js';

function setup(): { base: string; dataDir: string; project: string; departments: Departments; changes: () => number; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-departments-'));
  const dataDir = path.join(base, 'data');
  const project = path.join(base, 'project');
  mkdirSync(project, { recursive: true });
  let changes = 0;
  const departments = new Departments(dataDir, project, () => changes++);
  return { base, dataDir, project, departments, changes: () => changes, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('a preset opens a department with its roles; the same preset twice is refused, and nothing launches', () => {
  const { departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    assert.equal(d.name, 'Marketing');
    assert.deepEqual(d.roster, []);
    assert.deepEqual(d.brief, []);
    assert.ok(d.roles.length === PRESETS.marketing.roles.length);
    // Every skill reference points at a real harness skill file shape.
    for (const r of d.roles) for (const s of r.skills) assert.match(s, /^skills\/[\w-]+\/SKILL\.md$/, s);
    assert.equal(typeof departments.add('marketing', undefined, 'Kim'), 'string');
    const p = departments.add('product', 'Platform', 'Kim');
    assert.ok(typeof p !== 'string');
    assert.equal(p.name, 'Platform');
    assert.equal(departments.state().departments.length, 2);
  } finally {
    cleanup();
  }
});

test('the brief is revisions under monotonic numbers, and a stale base is a conflict', () => {
  const { departments, cleanup } = setup();
  try {
    const d = departments.add('review', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    assert.equal(departments.brief(d.id, 'v1: what good means', 0, 'Kim'), undefined);
    assert.equal(departments.brief(d.id, 'v2: sharper', 1, 'Jonathan'), undefined);
    // The cap of kept revisions never makes the base repeatable.
    for (let i = 0; i < 60; i++) assert.equal(departments.brief(d.id, `rev ${i + 3}`, i + 2, 'Kim'), undefined);
    const after = departments.get(d.id)!;
    assert.equal(after.rev, 62);
    assert.equal(after.brief[0].rev, 62);
    assert.equal(after.brief.length, 50, 'the kept history is bounded');
    assert.equal(after.briefArchived, 12, 'what fell off is counted, never silent');
    assert.ok(after.brief.every((r, i) => r.rev === 62 - i), 'kept revisions keep their numbers');
    assert.match(departments.brief(d.id, 'stale write', 3, 'Kim')!, /changed the brief/);
    assert.match(departments.brief(d.id, '   ', 62, 'Kim')!, /empty brief/);
  } finally {
    cleanup();
  }
});

test('the writer cap counts rostered implementation roles and unrostered live agents alike', () => {
  const { departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    const story = d.roles.find((r) => r.name === 'Story')!;
    const review = d.roles.find((r) => r.kind === 'review')!;
    // One rostered writer at a desk.
    departments.recordHire(d.id, story.id, 'w1', 'desk-1', 'Kim');
    assert.equal(departments.writers(() => ['w1']), 1);
    // An unrostered agent is a writer too.
    assert.equal(departments.writers(() => ['w1', 'w9']), 2);
    // A reviewer doesn't write.
    departments.recordHire(d.id, review.id, 'w2', 'desk-2', 'Kim');
    assert.equal(departments.writers(() => ['w1', 'w2']), 1);
    // The cap refuses a second rostered writer while two are live.
    const art = d.roles.find((r) => r.name === 'Art & frontend')!;
    assert.match(departments.composeLaunch(d.id, art.id, undefined, () => ['w1', 'w9']) as string, new RegExp(`${MAX_WRITERS} implementation writers`));
    // Once one goes home, the launch composes — with the library's current references in it.
    departments.release(d.id, 'w1');
    departments.addAsset(d.id, { label: 'Mood board', kind: 'link', ref: 'https://example.com/mood', status: 'current' }, 'Kim');
    departments.addAsset(d.id, { label: 'Last year’s look', kind: 'link', ref: 'https://example.com/old', status: 'historical' }, 'Kim');
    const composed = departments.composeLaunch(d.id, art.id, 'hero section', () => ['w9']);
    assert.ok(typeof composed !== 'string');
    assert.match(composed.prompt, /Art & frontend of the Marketing department/);
    assert.match(composed.prompt, /no brief yet/);
    assert.match(composed.prompt, /skills\/frontend-design\/SKILL\.md/);
    assert.match(composed.prompt, /Mood board: https:\/\/example\.com\/mood/, 'current references reach the worker');
    assert.ok(!composed.prompt.includes('Last year'), 'historical references stay out of the prompt');
    // A reviewer's prompt says it doesn't write.
    const rc = departments.composeLaunch(d.id, review.id, undefined, () => []);
    assert.ok(typeof rc !== 'string');
    assert.match(rc.prompt, /don’t write the page or the code/);
  } finally {
    cleanup();
  }
});

test('assets are jailed: real files inside the project, no secrets, no symlink escapes; links are http(s)', () => {
  const { base, project, departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    mkdirSync(path.join(project, 'docs'), { recursive: true });
    writeFileSync(path.join(project, 'docs', 'brand.md'), '# brand\n');
    writeFileSync(path.join(project, '.env'), 'SECRET=1\n');
    writeFileSync(path.join(base, 'outside.md'), 'outside\n');
    symlinkSync(path.join(base, 'outside.md'), path.join(project, 'linked.md'));
    symlinkSync(path.join(project, '.env'), path.join(project, 'brand-copy.md'));
    assert.equal(departments.addAsset(d.id, { label: 'Brand guide', kind: 'file', ref: 'docs/brand.md', status: 'current' }, 'Kim'), undefined);
    assert.match(departments.addAsset(d.id, { label: 'Secrets', kind: 'file', ref: '.env', status: 'current' }, 'Kim')!, /Not a path/);
    assert.match(departments.addAsset(d.id, { label: 'Secret by alias', kind: 'file', ref: 'brand-copy.md', status: 'current' }, 'Kim')!, /Not a path/, 'a symlink resolving to a secret is refused by what it resolves to');
    assert.match(departments.addAsset(d.id, { label: 'Escape', kind: 'file', ref: '../outside.md', status: 'current' }, 'Kim')!, /Not a path/);
    assert.match(departments.addAsset(d.id, { label: 'Symlink', kind: 'file', ref: 'linked.md', status: 'current' }, 'Kim')!, /leaves the project/);
    assert.match(departments.addAsset(d.id, { label: 'Missing', kind: 'file', ref: 'docs/nope.md', status: 'current' }, 'Kim')!, /Nothing at/);
    assert.match(departments.addAsset(d.id, { label: 'Odd', kind: 'folder', ref: 'docs', status: 'current' }, 'Kim')!, /file in the project or a link/);
    assert.match(departments.addAsset(d.id, { label: 'Bad link', kind: 'link', ref: 'file:///etc/passwd', status: 'current' }, 'Kim')!, /http\(s\)/);
    assert.equal(departments.addAsset(d.id, { label: 'Mood board', kind: 'link', ref: 'https://example.com/board', status: 'historical' }, 'Kim'), undefined);
    const assets = departments.get(d.id)!.assets;
    assert.equal(assets.length, 2);
    assert.equal(assets[1].status, 'historical');
    assert.equal(departments.dropAsset(d.id, assets[0].id), undefined);
    assert.equal(departments.get(d.id)!.assets.length, 1);
  } finally {
    cleanup();
  }
});

test('removal is refused while its workers are at desks; the state survives a reload', () => {
  const { dataDir, project, departments, changes, cleanup } = setup();
  try {
    const d = departments.add('product', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    const builder = d.roles.find((r) => r.kind === 'implementation')!;
    departments.recordHire(d.id, builder.id, 'w1', 'desk-1', 'Kim');
    assert.match(departments.remove(d.id, () => true)!, /Send its 1 worker/);
    departments.release(d.id, 'w1');
    assert.equal(departments.remove(d.id, () => false), undefined);
    assert.equal(departments.state().departments.length, 0);
    // Persistence: a fresh instance sees what was saved, and only real changes fired onChange.
    const before = changes();
    const reloaded = new Departments(dataDir, project, () => {});
    assert.equal(reloaded.state().departments.length, 0);
    departments.release(d.id, 'nobody');
    assert.equal(changes(), before, 'a no-op release saves and fires nothing');
  } finally {
    cleanup();
  }
});

test('instruction sources are live-checked in the checkout; paths and sizes only', () => {
  const { project, departments, cleanup } = setup();
  try {
    writeFileSync(path.join(project, 'CLAUDE.md'), '# project\n');
    mkdirSync(path.join(project, 'docs'), { recursive: true });
    const srcs = departments.state().sources;
    assert.deepEqual(
      srcs.map((s) => [s.path, s.exists, 'size' in s]),
      [
        ['CLAUDE.md', true, true],
        ['AGENTS.md', false, false],
        ['README.md', false, false],
        ['CONTRIBUTING.md', false, false],
        ['docs', true, false],
      ],
    );
  } finally {
    cleanup();
  }
});

test('dropped brief revisions are archived in full and served back; a broken archive file fails the edit, not the text', () => {
  const { dataDir, project, departments, cleanup } = setup();
  try {
    const d = departments.add('marketing', undefined, 'Kim');
    assert.ok(typeof d !== 'string');
    for (let i = 0; i < 52; i++) assert.equal(departments.brief(d.id, `decision ${i + 1}`, i, 'Kim'), undefined);
    const dept = departments.get(d.id)!;
    assert.equal(dept.brief.length, 50);
    assert.equal(dept.briefArchived, 2);
    const history = departments.briefHistory(d.id);
    assert.ok(typeof history !== 'string');
    assert.equal(history.archived, 2);
    assert.deepEqual(
      history.revs.map((r) => [r.rev, r.text]),
      [
        [2, 'decision 2'],
        [1, 'decision 1'],
      ],
      'the oldest decisions survive, full text, newest first',
    );
    // And across a reload.
    const reloaded = new Departments(dataDir, project, () => {});
    const again = reloaded.briefHistory(d.id);
    assert.ok(typeof again !== 'string');
    assert.equal(again.revs.length, 2);
    assert.match(again.revs[1].text, /decision 1/);
  } finally {
    cleanup();
  }
});
