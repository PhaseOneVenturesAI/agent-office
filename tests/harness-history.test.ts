import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarnessSources } from '../src/server/harness-history/index.js';
import { hashText } from '../src/server/harness-history/paths.js';

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-harness-history-'));
  const root = path.join(dir, 'source'), data = path.join(dir, 'data');
  mkdirSync(root); mkdirSync(data); mkdirSync(path.join(root, 'skills'));
  writeFileSync(path.join(root, 'CLAUDE.md'), '# Shared defaults\nKeep project facts in the project.\n');
  writeFileSync(path.join(root, 'skills/review.md'), 'Review current evidence.\n');
  const store = new HarnessSources(root, data);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const edit = (text: string, rel = 'CLAUDE.md') => store.change({ path: rel, base: store.read(rel).revision, action: 'edit', text }, 'Jonathan');
  return { dir, root, data, store, edit };
}
const status = (expected: number) => (error: any) => error.status === expected;

test('save retains exact prior text, revision and actor across restart without provider writes', (t) => {
  const f = fixture(t), original = f.store.read('CLAUDE.md');
  const text = '\r\n  Keep exact whitespace.  \r\n';
  const saved = f.edit(text);
  assert.equal(readFileSync(path.join(f.root, 'CLAUDE.md'), 'utf8'), text);
  assert.equal(saved.file.revision, hashText(text));
  const again = new HarnessSources(f.root, f.data), entry = again.revisions(original.path).revisions[0];
  assert.equal(entry.by, 'Jonathan'); assert.equal(entry.outcome, 'applied'); assert.equal(entry.before, original.revision);
  assert.equal(again.snapshot(original.path, entry.id).text, original.text);
  assert.deepEqual(readdirSync(f.data), ['harness-history']);
  assert.equal(existsSync(path.join(f.root, 'CLAUDE.md.bak')), false);
});

test('required hashes reject a changed source even if mtime is reused, and reject deleted source recreation', (t) => {
  const f = fixture(t), source = f.store.read('CLAUDE.md'), file = path.join(f.root, source.path);
  utimesSync(file, 1234, 1234);
  const base = f.store.read(source.path).revision;
  writeFileSync(file, 'Concurrent uncommitted edit'); utimesSync(file, 1234, 1234);
  assert.throws(() => f.store.change({ path: source.path, base, action: 'edit', text: 'Stale draft' }, 'A'), status(409));
  assert.throws(() => f.store.change({ path: source.path, action: 'edit', text: 'No base' } as any, 'A'), status(400));
  assert.equal(readFileSync(file, 'utf8'), 'Concurrent uncommitted edit');
  unlinkSync(file);
  assert.throws(() => f.store.change({ path: source.path, base, action: 'edit', text: 'Recreate' }, 'A'), status(409));
  assert.equal(existsSync(file), false); assert.deepEqual(f.store.historicalPaths(), []);
});

test('restoring a retained preimage records replaced text and requires the fresh base', (t) => {
  const f = fixture(t), original = f.store.read('CLAUDE.md'), saved = f.edit('New shared direction');
  const revision = f.store.revisions(original.path).revisions[0].id;
  assert.throws(() => f.store.change({ path: original.path, base: original.revision, action: 'restore', revision }, 'A'), status(409));
  const restored = f.store.change({ path: original.path, base: saved.file.revision, action: 'restore', revision }, 'A');
  assert.equal(restored.file.text, original.text);
  const history = f.store.revisions(original.path).revisions;
  assert.equal(history[0].restoredFrom, revision);
  assert.equal(f.store.snapshot(original.path, history[0].id).text, 'New shared direction');
  unlinkSync(path.join(f.root, original.path));
  const missing = f.store.read(original.path);
  assert.equal(missing.status, 'missing');
  assert.throws(() => f.store.change({ path: original.path, base: missing.revision, action: 'edit', text: 'Implicit recreation' }, 'A'), status(409));
  f.store.change({ path: original.path, base: missing.revision, action: 'restore', revision }, 'A');
  assert.equal(f.store.read(original.path).text, original.text);
});

test('legacy backup stays unchanged and is retained once with honest provenance before new edits', (t) => {
  const f = fixture(t), backup = path.join(f.root, 'CLAUDE.md.bak');
  writeFileSync(backup, 'Earlier one-deep backup');
  f.edit('First new edit'); f.edit('Second new edit');
  const history = f.store.revisions('CLAUDE.md').revisions, legacy = history.filter((entry) => entry.action === 'legacy');
  assert.equal(history.length, 3); assert.equal(legacy.length, 1);
  assert.equal(legacy[0].by, null); assert.equal(legacy[0].outcome, 'retained');
  assert.equal(f.store.snapshot('CLAUDE.md', legacy[0].id).text, 'Earlier one-deep backup');
  assert.equal(readFileSync(backup, 'utf8'), 'Earlier one-deep backup');
  unlinkSync(backup);
  const current = f.store.read('CLAUDE.md');
  f.store.change({ path: current.path, base: current.revision, action: 'restore', revision: legacy[0].id }, 'Jonathan');
  assert.equal(f.store.read('CLAUDE.md').text, 'Earlier one-deep backup');
});

test('history retains all edits beyond fifty and supports older pages', (t) => {
  const f = fixture(t), original = f.store.read('CLAUDE.md');
  for (let i = 0; i < 57; i++) f.edit(`Shared revision ${i}`);
  const first = f.store.revisions('CLAUDE.md'), rest = f.store.revisions('CLAUDE.md', first.next);
  assert.equal(first.revisions.length, 50); assert.ok(first.next);
  assert.equal(rest.revisions.length, 7); assert.equal(rest.next, undefined);
  assert.equal(f.store.snapshot('CLAUDE.md', rest.revisions.at(-1)!.id).text, original.text);
});

test('source roots and paths isolate histories even when they use one Office data directory', (t) => {
  const a = fixture(t), b = fixture(t); a.edit('A only');
  const entry = a.store.revisions('CLAUDE.md').revisions[0];
  const other = new HarnessSources(b.root, a.data);
  assert.deepEqual(other.revisions('CLAUDE.md').revisions, []);
  assert.throws(() => other.snapshot('CLAUDE.md', entry.id));
  assert.throws(() => a.store.snapshot('skills/review.md', entry.id));
  assert.notEqual(other.read('CLAUDE.md').text, 'A only');
  assert.throws(() => new HarnessSources(a.dir, a.data), /outside/);
});

test('every source access rejects traversal, hidden/private locations, symlinks and hardlinks', (t) => {
  const f = fixture(t), other = fixture(t);
  writeFileSync(path.join(f.root, 'credentials.json'), '{"fixture":"not-real"}');
  symlinkSync('credentials.json', path.join(f.root, 'innocent.json'));
  symlinkSync(other.root, path.join(f.root, 'external'));
  linkSync(path.join(f.root, 'credentials.json'), path.join(f.root, 'alias.json'));
  for (const rel of ['../CLAUDE.md', '/CLAUDE.md', './CLAUDE.md', 'skills//review.md', 'credentials.json', 'auth.json', '.env.md', '.claude/CLAUDE.md', 'homes/person/CLAUDE.md', 'innocent.json', 'alias.json', 'external/CLAUDE.md']) {
    assert.throws(() => f.store.read(rel), rel);
    assert.throws(() => f.store.revisions(rel), rel);
    assert.throws(() => f.store.change({ path: rel, base: 'x', action: 'edit', text: 'bad' }, 'A'), rel);
  }
  symlinkSync(path.join(other.root, 'CLAUDE.md'), path.join(f.root, 'CLAUDE.md.bak'));
  assert.throws(() => f.edit('must not follow backup'), /Links/);
});

test('supported formats remain text-only and credential material or invalid UTF8 cannot be exposed', (t) => {
  const f = fixture(t);
  for (const ext of ['md', 'txt', 'json', 'toml', 'yaml', 'yml']) {
    writeFileSync(path.join(f.root, `brief.${ext}`), 'Text source');
    assert.equal(f.store.read(`brief.${ext}`).text, 'Text source');
  }
  writeFileSync(path.join(f.root, 'leak.md'), 'ghp_' + 'X'.repeat(40));
  assert.throws(() => f.store.read('leak.md'), /credential/);
  assert.throws(() => f.edit('-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----'), /credential/);
  assert.throws(() => f.edit('é'.repeat(128001)), status(413));
  assert.throws(() => f.edit('Unpaired surrogate: \ud800'), /invalid Unicode/);
  const bytes = Buffer.from([0xff, 0xfe, 0x61]);
  writeFileSync(path.join(f.root, 'invalid.txt'), bytes);
  assert.throws(() => f.store.read('invalid.txt'), /UTF-8/);
  assert.deepEqual(readFileSync(path.join(f.root, 'invalid.txt')), bytes);
});

test('history remains inspectable if the source parent is moved or replaced by a symlink', (t) => {
  const f = fixture(t), other = fixture(t), rel = 'skills/review.md', old = f.store.read(rel);
  f.edit('Changed review', rel);
  const entry = f.store.revisions(rel).revisions[0];
  renameSync(path.join(f.root, 'skills'), path.join(f.root, 'moved-skills'));
  for (const alias of [false, true]) {
    if (alias) symlinkSync(path.join(other.root, 'skills'), path.join(f.root, 'skills'));
    const unavailable = f.store.read(rel);
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(f.store.snapshot(rel, entry.id).text, old.text);
    assert.equal(f.store.revisions(rel).revisions.length, 1);
    assert.throws(() => f.store.change({ path: rel, base: unavailable.revision, action: 'restore', revision: entry.id }, 'A'));
  }
  assert.equal(other.store.read(rel).text, old.text);
});

test('journal or replacement failure leaves acknowledged source unchanged with honest attempt status', (t) => {
  const f = fixture(t), before = f.store.read('CLAUDE.md');
  writeFileSync(path.join(f.data, 'harness-history'), 'not a directory');
  assert.throws(() => f.edit('cannot journal'));
  assert.equal(f.store.read(before.path).text, before.text);
  unlinkSync(path.join(f.data, 'harness-history'));
  (f.store as any).replace = () => { throw new Error('Fixture replacement failure'); };
  assert.throws(() => f.edit('cannot replace'), /not changed/);
  assert.equal(f.store.read(before.path).text, before.text);
  const entry = f.store.revisions(before.path).revisions[0];
  assert.equal(entry.outcome, 'failed'); assert.equal(f.store.snapshot(before.path, entry.id).text, before.text);
  assert.equal(readdirSync(f.root).some((name) => name.endsWith('.tmp')), false);
});

test('failed completion receipt reports the actual changed source and retained unconfirmed preimage', (t) => {
  const f = fixture(t), old = f.store.read('CLAUDE.md');
  (f.store as any).journal.receipt = () => false;
  const result = f.edit('Saved, receipt unavailable');
  assert.equal(result.file.text, readFileSync(path.join(f.root, old.path), 'utf8'));
  assert.match(result.warning!, /source changed/);
  const entry = f.store.revisions(old.path).revisions[0];
  assert.equal(entry.outcome, 'unconfirmed'); assert.equal(f.store.snapshot(old.path, entry.id).text, old.text);
});

test('external write during journaling remains canonical and the interrupted save is marked failed', (t) => {
  const f = fixture(t), journal = (f.store as any).journal;
  const record = journal.record.bind(journal);
  journal.record = (entry: unknown) => { record(entry); writeFileSync(path.join(f.root, 'CLAUDE.md'), 'External edit during save'); };
  assert.throws(() => f.edit('Old draft'), status(409));
  assert.equal(f.store.read('CLAUDE.md').text, 'External edit during save');
  assert.equal(f.store.revisions('CLAUDE.md').revisions[0].outcome, 'failed');
});

test('history symlinks and snapshot substitution never expose or overwrite another directory', (t) => {
  const f = fixture(t), elsewhere = fixture(t);
  symlinkSync(elsewhere.data, path.join(f.data, 'harness-history'));
  assert.throws(() => f.edit('blocked'), /history storage/);
  assert.deepEqual(readdirSync(elsewhere.data), []);
  unlinkSync(path.join(f.data, 'harness-history')); f.edit('Current');
  const entry = f.store.revisions('CLAUDE.md').revisions[0];
  const stored = path.join(f.data, 'harness-history', hashText(f.store.root), hashText('CLAUDE.md'), `${entry.id}.json`);
  unlinkSync(stored); symlinkSync(path.join(elsewhere.root, 'CLAUDE.md'), stored);
  assert.throws(() => f.store.snapshot('CLAUDE.md', entry.id));
  assert.equal(elsewhere.store.read('CLAUDE.md').text, '# Shared defaults\nKeep project facts in the project.\n');
});
