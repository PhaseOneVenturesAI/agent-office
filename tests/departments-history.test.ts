import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Departments } from '../src/server/departments.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-department-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'), project = path.join(root, 'project');
  mkdirSync(data); mkdirSync(project);
  const store = new Departments(data, project, () => {});
  const added = store.add('marketing', 'Marketing', 'Owner');
  assert.notEqual(typeof added, 'string');
  if (typeof added === 'string') throw new Error(added);
  const save = (revision: number) => store.brief(added.id, `Exact decision ${revision}`, revision - 1, 'Owner');
  return { store, data, project, id: added.id, save };
}

function retained(store: Departments, id: string) {
  const kept = store.get(id)!.brief;
  const archived: typeof kept = [];
  let before: number | undefined;
  do {
    // The optional cursor pages retained history; it must never prune stored text.
    const page = store.briefHistory(id, before);
    assert.notEqual(typeof page, 'string');
    if (typeof page === 'string') throw new Error(page);
    archived.push(...page.revs);
    before = page.next;
  } while (before !== undefined);
  return [...kept, ...archived];
}

test('department decisions remain inspectable beyond both former history caps and restart', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 260; n++) assert.equal(f.save(n), undefined);
  const reopened = new Departments(f.data, f.project, () => {});
  const all = retained(reopened, f.id);
  assert.equal(all.length, 260);
  assert.equal(new Set(all.map(r => r.rev)).size, 260);
  for (let n = 1; n <= 260; n++) assert.equal(all.find(r => r.rev === n)?.text, `Exact decision ${n}`);
});

test('failed archive rename does not publish an unsaved history mutation', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 50; n++) assert.equal(f.save(n), undefined);
  const archive = path.join(f.data, 'departments-brief-archive.json');
  mkdirSync(archive); // A fixture-only conflicting destination makes rename fail.
  assert.match(f.save(51) ?? '', /preserve|history|save/i);
  assert.equal(f.store.get(f.id)!.rev, 50);
  const result = f.store.briefHistory(f.id);
  assert.notEqual(typeof result, 'string');
  if (typeof result !== 'string') assert.equal(result.revs.length, 0);
  rmSync(archive, { recursive: true });
  assert.equal(f.save(51), undefined);
  assert.equal(retained(f.store, f.id).length, 51);
});

test('retry after main-state failure retains each historical revision once', (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 50; n++) assert.equal(f.save(n), undefined);
  const file = path.join(f.data, 'departments.json'), backup = `${file}.fixture-backup`;
  renameSync(file, backup); mkdirSync(file);
  assert.match(f.save(51) ?? '', /save/i);
  assert.equal(f.store.get(f.id)!.rev, 50);
  rmSync(file, { recursive: true }); renameSync(backup, file);
  assert.equal(f.save(51), undefined);
  const reopened = new Departments(f.data, f.project, () => {});
  const all = retained(reopened, f.id);
  assert.equal(all.length, 51);
  assert.equal(new Set(all.map(r => r.rev)).size, 51);
});
