import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { Departments } from '../src/server/departments.js';
import { Docs } from '../src/server/docs.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-department-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), data = path.join(root, 'data');
  mkdirSync(project); mkdirSync(data);
  writeFileSync(path.join(project, '.env'), 'FIXTURE_ONLY=not-a-real-secret');
  writeFileSync(path.join(project, 'brand.md'), '# Current brand guide');
  const departments = new Departments(data, project, () => {});
  const dept = departments.add('marketing', 'Marketing', 'Owner');
  assert.notEqual(typeof dept, 'string');
  if (typeof dept === 'string') throw new Error(dept);
  assert.equal(departments.addAsset(dept.id, { kind: 'file', ref: 'brand.md', label: 'Guide', status: 'current' }, 'Owner'), undefined);
  return { project, departments, dept, docs: new Docs(project) };
}

test('a changed Markdown brand reference is revalidated when opened', async (t) => {
  const f = fixture(t);
  unlinkSync(path.join(f.project, 'brand.md'));
  symlinkSync('.env', path.join(f.project, 'brand.md'));
  const result = await f.docs.read('brand.md');
  assert.ok('error' in result, 'A stored reference must not reveal a newly aliased private target');
});

test('launch does not instruct an agent to read a brand reference that became unsafe', (t) => {
  const f = fixture(t);
  unlinkSync(path.join(f.project, 'brand.md'));
  symlinkSync('.env', path.join(f.project, 'brand.md'));
  const launch = f.departments.composeLaunch(f.dept.id, f.dept.roles[0].id, 'Review this page', () => []);
  assert.ok(typeof launch === 'string' || !launch.prompt.includes('brand.md'), 'Unsafe references cannot remain in a launch prompt');
});

test('a hard-linked private file cannot be registered or served as a brand image', async (t) => {
  const f = fixture(t);
  linkSync(path.join(f.project, '.env'), path.join(f.project, 'logo.svg'));
  assert.equal(typeof f.departments.addAsset(f.dept.id, { kind: 'file', ref: 'logo.svg', label: 'Logo', status: 'current' }, 'Owner'), 'string');
  assert.ok('error' in await f.docs.asset('logo.svg'));
});

test('the existing media route still rejects a changed symlink target', async (t) => {
  const f = fixture(t);
  symlinkSync('.env', path.join(f.project, 'logo.svg'));
  assert.ok('error' in await f.docs.asset('logo.svg'));
});

test('the bookshelf never reads titles from tracked private aliases', async (t) => {
  const f = fixture(t);
  execFileSync('git', ['init', '-q'], { cwd: f.project });
  unlinkSync(path.join(f.project, 'brand.md'));
  symlinkSync('.env', path.join(f.project, 'brand.md'));
  execFileSync('git', ['add', 'brand.md'], { cwd: f.project });
  assert.equal((await f.docs.list()).files.some((file) => file.path === 'brand.md'), false);
});

test('normal project Markdown, image and video references still open', async (t) => {
  const f = fixture(t);
  assert.ok('text' in await f.docs.read('brand.md'));
  for (const [name, type, bytes] of [
    ['logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['scene.mp4', 'video/mp4', 'fixture bytes'],
  ]) {
    writeFileSync(path.join(f.project, name), bytes);
    assert.equal(f.departments.addAsset(f.dept.id, { kind: 'file', ref: name, label: name, status: 'current' }, 'Owner'), undefined);
    const result = await f.docs.asset(name);
    assert.ok('body' in result);
    if ('body' in result) { assert.equal(result.type, type); assert.equal(result.body.toString(), bytes); }
  }
});
