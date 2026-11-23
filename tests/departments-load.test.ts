import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Departments } from '../src/server/departments.js';

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-departments-load-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'), project = path.join(root, 'project');
  mkdirSync(data); mkdirSync(project);
  return { data, project, file: path.join(data, 'departments.json'), archive: path.join(data, 'departments-brief-archive.json') };
}

function seed(f: ReturnType<typeof fixture>, revisions = 1) {
  const store = new Departments(f.data, f.project, () => {});
  const added = store.add('marketing', 'Existing department', 'Owner');
  assert.ok(typeof added !== 'string');
  for (let rev = 1; rev <= revisions; rev++) assert.equal(store.brief(added.id, `Preserved decision ${rev}`, rev - 1, 'Owner'), undefined);
  return store.get(added.id)!;
}

test('ENOENT is a normal new store and a normal not-yet-created archive', (t) => {
  const f = fixture(t);
  const store = new Departments(f.data, f.project, () => {});
  assert.deepEqual(store.state().departments, []);
  const added = store.add('marketing', 'New department', 'Owner');
  assert.ok(typeof added !== 'string');
  assert.equal(store.brief(added.id, 'First decision', 0, 'Owner'), undefined);
  // No revision has overflowed into the archive yet, so its absence must still be allowed.
  const reopened = new Departments(f.data, f.project, () => {});
  assert.equal(reopened.brief(added.id, 'Second decision', 1, 'Owner'), undefined);
  assert.equal(reopened.get(added.id)?.brief[1].text, 'First decision');
});

const badMain = {
  'invalid JSON': (valid: unknown) => JSON.stringify([valid]).slice(0, -1),
  'wrong top-level shape': (valid: unknown) => JSON.stringify({ departments: [valid] }),
  'one invalid record among valid records': (valid: unknown) => JSON.stringify([valid, { id: 'recoverable-invalid-record' }]),
  'invalid nested revision': (valid: unknown) => JSON.stringify([{ ...valid as object, brief: [{ rev: 1, text: 17, by: 'Owner', at: 1 }] }]),
};

for (const [label, encode] of Object.entries(badMain)) {
  test(`main-state load fails closed for ${label}, preserving the entire original file`, (t) => {
    const f = fixture(t), existing = seed(f);
    const original = encode(existing);
    writeFileSync(f.file, original);
    let changes = 0;
    const reopened = new Departments(f.data, f.project, () => changes++);
    const before = structuredClone(reopened.state());
    assert.equal(typeof reopened.add('product', 'Must not replace history', 'Owner'), 'string');
    assert.deepEqual(reopened.state(), before, 'a rejected mutation must not publish partial loaded data or new state');
    assert.equal(changes, 0);
    assert.equal(readFileSync(f.file, 'utf8'), original, 'invalid entries must not be filtered away during a later save');
  });
}

const badArchive = {
  'invalid JSON': (valid: Record<string, unknown>) => JSON.stringify(valid).slice(0, -1),
  'wrong top-level shape': (valid: Record<string, unknown>) => JSON.stringify([valid]),
  'invalid department bucket': (valid: Record<string, unknown>) => JSON.stringify({ ...valid, 'another-department': { recoverable: true } }),
  'one invalid revision among valid revisions': (valid: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(valid).map(([id, revs]) => [id, [...revs as unknown[], { rev: 2, text: 17, by: 'Owner', at: 1 }]]))),
};

for (const [label, encode] of Object.entries(badArchive)) {
  test(`archive load fails closed for ${label}, preserving main state and all archive bytes`, (t) => {
    const f = fixture(t), existing = seed(f, 51);
    const mainBefore = readFileSync(f.file, 'utf8');
    const original = encode(JSON.parse(readFileSync(f.archive, 'utf8')));
    writeFileSync(f.archive, original);
    let changes = 0;
    const reopened = new Departments(f.data, f.project, () => changes++);
    const before = structuredClone(reopened.state());
    assert.equal(typeof reopened.brief(existing.id, 'Must not discard older decisions', 51, 'Owner'), 'string');
    assert.deepEqual(reopened.state(), before);
    assert.equal(changes, 0);
    assert.equal(readFileSync(f.file, 'utf8'), mainBefore);
    assert.equal(readFileSync(f.archive, 'utf8'), original);
  });
}

test('a main-state read error is not treated as ENOENT even when the path later becomes writable', (t) => {
  const f = fixture(t);
  seed(f);
  const original = readFileSync(f.file, 'utf8');
  rmSync(f.file); mkdirSync(f.file); // EISDIR is deterministic, unlike chmod under a privileged runner.
  let changes = 0;
  const reopened = new Departments(f.data, f.project, () => changes++);
  const before = structuredClone(reopened.state());
  rmSync(f.file, { recursive: true }); writeFileSync(f.file, original);
  assert.equal(typeof reopened.add('product', 'Do not overwrite recovered source', 'Owner'), 'string');
  assert.deepEqual(reopened.state(), before);
  assert.equal(changes, 0);
  assert.equal(readFileSync(f.file, 'utf8'), original, 'a fresh successful load is required before mutation');
});

test('an archive read error cannot be forgotten when its original file becomes readable again', (t) => {
  const f = fixture(t), existing = seed(f, 51);
  const mainBefore = readFileSync(f.file, 'utf8'), original = readFileSync(f.archive, 'utf8');
  rmSync(f.archive); mkdirSync(f.archive);
  let changes = 0;
  const reopened = new Departments(f.data, f.project, () => changes++);
  const before = structuredClone(reopened.state());
  rmSync(f.archive, { recursive: true }); writeFileSync(f.archive, original);
  assert.equal(typeof reopened.brief(existing.id, 'Must not overwrite recovered archive', 51, 'Owner'), 'string');
  assert.deepEqual(reopened.state(), before);
  assert.equal(changes, 0);
  assert.equal(readFileSync(f.file, 'utf8'), mainBefore);
  assert.equal(readFileSync(f.archive, 'utf8'), original);
});
