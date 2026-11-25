import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ProjectContext } from '../src/server/project-context/index.js';
import { Docs } from '../src/server/docs.js';
import { projectContextRoute } from '../src/server/http/routes/project-context.js';
import { requestHandler } from '../src/server/http/router.js';

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-context-'));
  mkdirSync(path.join(dir, 'docs')); writeFileSync(path.join(dir, 'AGENTS.md'), '# Current instructions\nKeep project scope.\n');
  writeFileSync(path.join(dir, 'docs/brand.md'), '# Brand\nWarm, direct and useful.\n');
  const store = new ProjectContext(dir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store, edit: (text: string) => store.mutate({ path: 'AGENTS.md', base: store.read('AGENTS.md').revision, action: 'edit', text, reason: 'Explicit edit' }, 'Jonathan') };
}
const errorStatus = (status: number) => (e: any) => e.status === status;

test('project source is canonical: edits preserve uncommitted text and immutable history across restart', (t) => {
  const f = fixture(t), old = f.store.read('AGENTS.md');
  const result = f.edit('# Updated instructions\n');
  assert.equal(readFileSync(path.join(f.dir, 'AGENTS.md'), 'utf8'), result.file.text);
  const again = new ProjectContext(f.dir), entry = again.revisions('AGENTS.md').revisions[0];
  assert.equal(entry.outcome, 'applied'); assert.equal(entry.before, old.revision); assert.equal(entry.after, result.file.revision);
  assert.equal(again.snapshot('AGENTS.md', entry.id).text, old.text);
  assert.equal(existsSync(path.join(f.dir, '.git')), false, 'no git commit, initialization or push');
});

test('stale and externally deleted sources cannot silently replace or recreate current work', (t) => {
  const f = fixture(t), base = f.store.read('AGENTS.md').revision;
  writeFileSync(path.join(f.dir, 'AGENTS.md'), 'Another writer’s uncommitted work');
  assert.throws(() => f.store.mutate({ path: 'AGENTS.md', base, action: 'edit', text: 'stale', reason: 'edit' }, 'A'), errorStatus(409));
  assert.equal(readFileSync(path.join(f.dir, 'AGENTS.md'), 'utf8'), 'Another writer’s uncommitted work');
  unlinkSync(path.join(f.dir, 'AGENTS.md'));
  assert.throws(() => f.store.mutate({ path: 'AGENTS.md', base, action: 'edit', text: 'stale', reason: 'edit' }, 'A'), errorStatus(409));
  assert.equal(existsSync(path.join(f.dir, 'AGENTS.md')), false);
});

test('archive, supersede and restore keep source text, decision and restore evidence', (t) => {
  const f = fixture(t), initial = f.store.read('AGENTS.md');
  const archived = f.store.mutate({ path: initial.path, base: initial.revision, action: 'supersede', replacement: 'docs/brand.md', reason: 'Current direction lives in brand brief' }, 'Jonathan');
  assert.equal(archived.file.status, 'missing'); assert.equal(f.store.read(initial.path).revision, archived.file.revision);
  assert.equal(existsSync(path.join(f.dir, initial.path)), false);
  assert.ok(f.store.list([]).some((s) => s.path === initial.path && !s.present));
  const entry = f.store.revisions(initial.path).revisions[0];
  assert.equal(entry.supersededBy, 'docs/brand.md');
  const restored = f.store.mutate({ path: initial.path, base: archived.file.revision, action: 'restore', revision: entry.id, reason: 'Restore prior direction for review' }, 'Jonathan');
  assert.equal(restored.file.text, initial.text);
  const history = f.store.revisions(initial.path).revisions;
  assert.equal(history[0].restoredFrom, entry.id); assert.equal(history.length, 2);
  assert.equal(f.store.snapshot(initial.path, entry.id).text, initial.text);
  f.store.mutate({ path: initial.path, base: restored.file.revision, action: 'archive', reason: 'Retire source' }, 'Jonathan');
  assert.equal(f.store.revisions(initial.path).revisions[0].action, 'archive');
});

test('history beyond fifty edits is preserved and older pages are accessible', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 62; i++) f.edit(`Revision ${i}`);
  const first = f.store.revisions('AGENTS.md');
  assert.equal(first.revisions.length, 50); assert.ok(first.next);
  const older = f.store.revisions('AGENTS.md', first.next);
  assert.equal(older.revisions.length, 12); assert.equal(older.next, undefined);
  assert.equal(f.store.snapshot('AGENTS.md', older.revisions.at(-1)!.id).text, '# Current instructions\nKeep project scope.\n');
});

test('project isolation and every read/write reject escapes, aliases, private sources and credential text', (t) => {
  const a = fixture(t), b = fixture(t); a.edit('Project A');
  const entry = a.store.revisions('AGENTS.md').revisions[0];
  assert.throws(() => b.store.snapshot('AGENTS.md', entry.id));
  writeFileSync(path.join(a.dir, '.env.md'), 'FIXTURE_ONLY=not-a-real-secret');
  symlinkSync('.env.md', path.join(a.dir, 'innocent.md'));
  symlinkSync(b.dir, path.join(a.dir, 'external'));
  for (const rel of ['../AGENTS.md', '/etc/passwd.md', '.env.md', 'credentials.md', 'secrets.md', 'private/MEMORY.md', 'innocent.md', 'external/AGENTS.md', '.agent-office/homes/account/MEMORY.md']) {
    assert.throws(() => a.store.read(rel)); assert.throws(() => a.store.revisions(rel));
    assert.throws(() => a.store.mutate({ path: rel, base: 'x', action: 'edit', text: 'x', reason: 'bad path' }, 'A'));
  }
  assert.equal(a.store.list(['innocent.md', '.env.md', 'AGENTS.md']).length, 1);
  writeFileSync(path.join(a.dir, 'leak.md'), 'ghp_' + 'X'.repeat(40));
  assert.throws(() => a.store.read('leak.md'), /credential/);
  assert.throws(() => a.edit('-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----'), /credential/);
  const base = a.store.read('AGENTS.md').revision;
  unlinkSync(path.join(a.dir, 'AGENTS.md')); symlinkSync(path.join(b.dir, 'AGENTS.md'), path.join(a.dir, 'AGENTS.md'));
  assert.throws(() => a.store.mutate({ path: 'AGENTS.md', base, action: 'restore', revision: entry.id, reason: 'restore' }, 'A'));
});

test('failed journal or atomic replacement never changes canonical text; failed attempts remain distinct', (t) => {
  const f = fixture(t), initial = f.store.read('AGENTS.md');
  mkdirSync(path.join(f.dir, '.agent-office')); writeFileSync(path.join(f.dir, '.agent-office/project-context'), 'not a directory');
  assert.throws(() => f.edit('must not land'));
  assert.equal(f.store.read(initial.path).text, initial.text);
  unlinkSync(path.join(f.dir, '.agent-office/project-context'));
  (f.store as any).replace = () => { throw new Error('fixture rename failure'); };
  assert.throws(() => f.edit('also must not land'), /not changed/);
  assert.equal(f.store.read(initial.path).text, initial.text);
  const entry = f.store.revisions(initial.path).revisions[0];
  assert.equal(entry.outcome, 'failed'); assert.equal(f.store.snapshot(initial.path, entry.id).text, initial.text);
  assert.ok(!readdirSync(f.dir).some((p) => p.endsWith('.tmp')));
});

test('history storage symlinks cannot leak or redirect archived text', (t) => {
  const f = fixture(t), elsewhere = fixture(t);
  mkdirSync(path.join(f.dir, '.agent-office'));
  symlinkSync(elsewhere.dir, path.join(f.dir, '.agent-office/project-context'));
  assert.throws(() => f.edit('blocked'), /history storage/);
  assert.throws(() => f.store.revisions('AGENTS.md'), /history storage/);
  assert.equal(existsSync(path.join(elsewhere.dir, 'source.json')), false);
});

test('gitignored conventional instructions are discoverable without scanning provider homes', (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.dir, '.claude/rules/team'), { recursive: true });
  writeFileSync(path.join(f.dir, 'CLAUDE.local.md'), 'Local project instruction');
  writeFileSync(path.join(f.dir, '.claude/CLAUDE.md'), 'Project Claude instruction');
  writeFileSync(path.join(f.dir, '.claude/rules/team/review.md'), 'Review instruction');
  writeFileSync(path.join(f.dir, '.claude/MEMORY.md'), 'Private location is not exposed');
  writeFileSync(path.join(f.dir, '.gitignore'), 'CLAUDE.local.md\n.claude/\n');
  const found = f.store.list([]).map((s) => s.path);
  assert.ok(found.includes('CLAUDE.local.md')); assert.ok(found.includes('.claude/CLAUDE.md')); assert.ok(found.includes('.claude/rules/team/review.md'));
  assert.ok(!found.includes('.claude/MEMORY.md')); assert.throws(() => f.store.read('.claude/MEMORY.md'));
  assert.equal(f.store.read('.claude/rules/team/review.md').text, 'Review instruction');
});

test('saved history survives renamed or unsafe current parents while restore refuses to follow them', (t) => {
  const f = fixture(t), elsewhere = fixture(t), old = f.store.read('docs/brand.md');
  f.store.mutate({ path: old.path, base: old.revision, action: 'edit', text: 'New brief', reason: 'Review direction' }, 'Jonathan');
  const revision = f.store.revisions(old.path).revisions[0];
  renameSync(path.join(f.dir, 'docs'), path.join(f.dir, 'moved-docs'));
  for (const unsafe of [false, true]) {
    if (unsafe) symlinkSync(path.join(elsewhere.dir, 'docs'), path.join(f.dir, 'docs'));
    const current = f.store.read(old.path);
    assert.equal(current.status, 'unavailable'); assert.equal(current.text, null);
    assert.equal(f.store.list([]).find((s) => s.path === old.path)?.unavailable, true);
    assert.equal(f.store.snapshot(old.path, revision.id).text, old.text);
    assert.equal(f.store.revisions(old.path).revisions.length, 1);
    assert.throws(() => f.store.mutate({ path: old.path, base: current.revision, action: 'restore', revision: revision.id, reason: 'Restore' }, 'Jonathan'));
  }
  assert.equal(elsewhere.store.read(old.path).text, old.text);
});

test('invalid UTF-8 is refused instead of being silently replaced during a save', (t) => {
  const f = fixture(t), bytes = Buffer.from([0xff, 0xfe, 0x61]);
  writeFileSync(path.join(f.dir, 'invalid.md'), bytes);
  assert.throws(() => f.store.read('invalid.md'), /valid UTF-8/);
  assert.deepEqual(readFileSync(path.join(f.dir, 'invalid.md')), bytes);
});

test('route requires authentication, admin same-origin mutation, and an explicit known floor', async (t) => {
  const a = fixture(t), b = fixture(t);
  const floors = new Map([['a', { id: 'a', def: { dir: a.dir, name: 'Project A' }, docs: new Docs(a.dir) }], ['b', { id: 'b', def: { dir: b.dir, name: 'Project B' }, docs: new Docs(b.dir) }]]);
  const ctx: any = { floorVisible: () => true, cfg: { port: 0, trustProxy: false }, floors, services: { lookup() {} }, auth: { fromRequest: (req: http.IncomingMessage) => req.headers.cookie ? { account: { id: req.headers.cookie } } : undefined }, meOf: (id: string) => ({ admin: id === 'admin', account: { name: id } }) };
  const server = http.createServer(requestHandler(ctx, [projectContextRoute]));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = `http://127.0.0.1:${(server.address() as any).port}`;
  const url = `${address}/api/project-context?floor=a`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(`${address}/api/project-context?floor=absent`, { headers: { cookie: 'admin' } })).status, 404);
  const listing = await (await fetch(url, { headers: { cookie: 'reader' } })).json();
  assert.equal(listing.scope.project, 'Project A'); assert.equal(listing.scope.loaded, 'unknown'); assert.equal(listing.canEdit, false);
  const ask = { path: 'AGENTS.md', base: a.store.read('AGENTS.md').revision, action: 'edit', text: 'Only Project A', reason: 'Project isolation' };
  const post = (cookie: string, origin: string) => fetch(url, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(ask) });
  assert.equal((await post('reader', address)).status, 403); assert.equal((await post('admin', 'https://other.example')).status, 403);
  assert.equal((await post('admin', address)).status, 200);
  assert.equal(a.store.read('AGENTS.md').text, 'Only Project A'); assert.notEqual(b.store.read('AGENTS.md').text, 'Only Project A');
});
