import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentCommitPrompt, Changes, insideCheckout, type ChangesTarget } from '../src/server/changes.js';
import { changesHandlers } from '../src/server/ws/handlers/changes.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import { changedImageType, type ChangesClientMsg, type ServerMsg, type WorkerInfo, type WorkerKind } from '../src/shared/protocol.js';

/** A git repo with one committed picture, and a Changes that diffs it against HEAD. */
function fixture(t: { after(fn: () => void): void }, pollMs?: number) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-changes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'repo');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'assets', 'logo.png'), 'old picture');
  writeFileSync(path.join(dir, 'assets', 'gone.gif'), 'deleted picture');
  writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const target: ChangesTarget = { name: 'Worker 1', cwd: dir, rel: '' };
  const changes = new Changes(dir, 'main', (id) => (id === 'w1' ? target : undefined), () => undefined, {
    state() {},
    toast() {},
    refreshGitHub() {},
  }, pollMs);
  t.after(() => changes.stop());
  return { root, dir, changes, git };
}

test('only pictures have a preview type, picked by extension', () => {
  assert.equal(changedImageType('assets/showcase/hero.webp'), 'image/webp');
  assert.equal(changedImageType('a/b/PHOTO.JPG'), 'image/jpeg');
  assert.equal(changedImageType('x.jpeg'), 'image/jpeg');
  assert.equal(changedImageType('icon.svg'), 'image/svg+xml');
  assert.equal(changedImageType('favicon.ico'), 'image/x-icon');
  for (const p of ['README.md', 'archive.zip', 'png', '.png', 'dir.png/file', 'x.constructor', 'x.__proto__', 'x.']) assert.equal(changedImageType(p), undefined, p);
});

test('a file outside the checkout, by .. or by a link, is refused', async (t) => {
  const { root, dir, changes } = fixture(t);
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.png'), 'secret');
  assert.equal(await insideCheckout(dir, 'assets/logo.png'), realpathSync(path.join(dir, 'assets', 'logo.png')));
  assert.equal(await insideCheckout(dir, '../outside/secret.png'), undefined);
  assert.equal(await insideCheckout(dir, path.join(outside, 'secret.png')), undefined);
  assert.equal(await insideCheckout(dir, 'missing.png'), undefined);
  // A junction works without admin rights on Windows; elsewhere it's an ordinary symlink.
  symlinkSync(outside, path.join(dir, 'link'), 'junction');
  assert.equal(await insideCheckout(dir, 'link/secret.png'), undefined);
  // Even when the link itself is one of the worker's changes.
  const r = await changes.file('w1', 'link/secret.png', 'new');
  assert.ok('error' in r && r.status === 404);
});

test('the preview serves both sides of a changed picture, and nothing outside the list of changes', async (t) => {
  const { root, dir, changes } = fixture(t);
  writeFileSync(path.join(dir, 'assets', 'logo.png'), 'new picture');
  writeFileSync(path.join(dir, 'assets', 'hero.webp'), 'added picture');
  writeFileSync(path.join(dir, 'notes.txt'), 'not a picture');
  rmSync(path.join(dir, 'assets', 'gone.gif'));

  const text = async (side: 'old' | 'new', p: string) => {
    const r = await changes.file('w1', p, side);
    if ('error' in r) return r;
    return { type: r.type, body: r.body.toString('utf8') };
  };
  assert.deepEqual(await text('old', 'assets/logo.png'), { type: 'image/png', body: 'old picture' });
  assert.deepEqual(await text('new', 'assets/logo.png'), { type: 'image/png', body: 'new picture' });
  assert.deepEqual(await text('new', 'assets/hero.webp'), { type: 'image/webp', body: 'added picture' });
  assert.equal((await text('old', 'assets/hero.webp') as { status: number }).status, 404);
  assert.deepEqual(await text('old', 'assets/gone.gif'), { type: 'image/gif', body: 'deleted picture' });
  assert.equal((await text('new', 'assets/gone.gif') as { status: number }).status, 404);

  // Not a picture, not changed, not in the checkout, no such worker.
  assert.equal((await text('new', 'notes.txt') as { status: number }).status, 415);
  writeFileSync(path.join(root, 'secret.png'), 'secret');
  for (const p of ['README.png', '../secret.png', path.join(root, 'secret.png')]) assert.equal((await text('new', p) as { status: number }).status, 404, p);
  assert.equal(((await changes.file('nobody', 'assets/logo.png', 'new')) as { status: number }).status, 404);
});

test('a renamed picture shows its old name before and its new name after', async (t) => {
  const { dir, changes } = fixture(t);
  execFileSync('git', ['mv', 'assets/logo.png', 'assets/brand.png'], { cwd: dir, stdio: 'ignore' });
  const old = await changes.file('w1', 'assets/brand.png', 'old');
  const now = await changes.file('w1', 'assets/brand.png', 'new');
  assert.ok(!('error' in old) && !('error' in now));
  assert.equal(old.body.toString('utf8'), 'old picture');
  assert.equal(now.body.toString('utf8'), 'old picture');
});

test('the commit-it-yourself prompt has the agent review, commit and write the message', () => {
  const p = agentCommitPrompt('your working directory');
  assert.match(p, /git status, git diff/);
  assert.match(p, /git add -A && git commit/);
  assert.match(p, /your working directory/);
  assert.match(p, /commit message yourself/);
  assert.match(p, /don't push/);
});

test('the commit-it-yourself prompt names the worker’s own checkout as where it works, another repository’s by path', (t) => {
  const { dir, changes } = fixture(t);
  assert.equal(changes.commitWhere('w1'), 'your working directory');
  assert.equal(changes.commitWhere('w1', 'floor-api'), `the checkout at ${dir}`);
  assert.equal(changes.commitWhere('nobody'), undefined);
});

/** A desk's Changes window pressing Commit, with the worker and its checkout faked. */
function commitDesk(opts: { kind?: WorkerKind; promptError?: string } = {}) {
  const sent: ServerMsg[] = [];
  const warnings: string[] = [];
  const prompts: { text: string; by?: string }[] = [];
  const commits: { message: string; who: string; repo?: string }[] = [];
  /** Resolves the office's wait for the agent's commit, as the checkout landing (or not landing) one would. */
  const settleCommit = (subject: string | undefined) => {
    assert.equal(waits.length, 1, 'the office is waiting for the agent’s commit');
    waits.shift()?.(subject);
  };
  const waits: ((subject: string | undefined) => void)[] = [];
  const info = { id: 'w1', kind: opts.kind ?? 'agent', provider: 'claude', name: 'Pixel', status: 'done' } as WorkerInfo;
  const changes = {
    commitWhere: (_id: string, repo?: string) => (repo ? 'the checkout at /workspace/api' : 'your working directory'),
    commit: (_id: string, message: string, who: string, _env: unknown, repo?: string) => {
      commits.push({ message, who, repo });
      return Promise.resolve(undefined);
    },
    confirmCommit: () => new Promise<string | undefined>((resolve) => waits.push(resolve)),
  };
  const workers = {
    get: (id: string) => (id === info.id ? info : undefined),
    ownerOf: () => undefined,
    prompt: (_id: string, text: string, by?: string) => {
      prompts.push({ text, by });
      return opts.promptError;
    },
  };
  const floor = { id: 'floor', workers, changes };
  const ctx = {
    workerFloor: () => floor,
    floorOf: () => floor,
    sendTo: (_c: unknown, msg: ServerMsg) => sent.push(msg),
    warn: (_c: unknown, err: string | undefined) => {
      if (err) warnings.push(err);
    },
  } as unknown as Ctx;
  const client = { id: 'browser', accountId: undefined, peer: { name: 'Cody', floor: 'floor' } } as unknown as Client;
  const commit = (msg: Extract<ChangesClientMsg, { t: 'changes.commit' }>) => changesHandlers['changes.commit'](ctx, client, msg);
  return { sent, warnings, prompts, commits, commit, settleCommit };
}

test('Commit with no message asks the worker’s agent to commit, writing the message itself', () => {
  const d = commitDesk();
  d.commit({ t: 'changes.commit', workerId: 'w1' });
  assert.equal(d.prompts.length, 1);
  assert.match(d.prompts[0].text, /git add -A && git commit/);
  assert.match(d.prompts[0].text, /your working directory/);
  assert.equal(d.prompts[0].by, 'Cody');
  assert.deepEqual(d.commits, []);
  assert.deepEqual(d.sent.map((m) => m.t), ['toast']);
});

test('Commit falls back to the person typing the message when the agent can’t be asked', () => {
  // A shell has no agent to ask.
  const shell = commitDesk({ kind: 'shell' });
  shell.commit({ t: 'changes.commit', workerId: 'w1' });
  assert.deepEqual(shell.prompts, []);
  assert.deepEqual(shell.sent, [{ t: 'changes.commitManual', workerId: 'w1', repo: undefined }]);
  // Asleep or gone: the prompt is refused.
  const asleep = commitDesk({ promptError: 'Worker is not running' });
  asleep.commit({ t: 'changes.commit', workerId: 'w1' });
  assert.equal(asleep.prompts.length, 1);
  assert.deepEqual(asleep.sent.map((m) => m.t), ['changes.commitManual']);
  assert.deepEqual(asleep.commits, []);
  // The fallback names the repository the commit was for.
  const repo = commitDesk({ kind: 'shell' });
  repo.commit({ t: 'changes.commit', workerId: 'w1', repo: 'floor-api' });
  assert.deepEqual(repo.sent, [{ t: 'changes.commitManual', workerId: 'w1', repo: 'floor-api' }]);
});

test('Commit with a typed message still commits as the person who pressed it, agent or not', async () => {
  const d = commitDesk({ kind: 'shell' });
  d.commit({ t: 'changes.commit', workerId: 'w1', message: 'Fix the flux capacitor' });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(d.commits, [{ message: 'Fix the flux capacitor', who: 'Cody', repo: undefined }]);
  assert.deepEqual(d.prompts, []);
  assert.deepEqual(d.sent, []);
  assert.deepEqual(d.warnings, []);
});


test('Commit with no message toasts the outcome once the agent’s commit lands', async () => {
  const d = commitDesk();
  d.commit({ t: 'changes.commit', workerId: 'w1' });
  d.settleCommit('Add the flux capacitor');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(d.sent.map((m) => m.t), ['toast', 'toast']);
  const done = d.sent[1];
  assert.ok(done.t === 'toast' && done.level === 'info' && done.text === '✅ Pixel committed “Add the flux capacitor”', JSON.stringify(done));
  assert.deepEqual(d.commits, []);
});

test('Commit with no message warns and offers the manual fallback when no commit lands', async () => {
  const d = commitDesk();
  d.commit({ t: 'changes.commit', workerId: 'w1', repo: 'floor-api' });
  d.settleCommit(undefined);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(d.sent.map((m) => m.t), ['toast', 'toast', 'changes.commitManual']);
  const warn = d.sent[1];
  assert.ok(warn.t === 'toast' && warn.level === 'warn' && warn.text.includes('Pixel'), JSON.stringify(warn));
  assert.deepEqual(d.sent[2], { t: 'changes.commitManual', workerId: 'w1', repo: 'floor-api' });
  assert.deepEqual(d.commits, []);
});

test('confirmCommit resolves with the subject once a new commit lands, and times out when none does', async (t) => {
  const { dir, changes, git } = fixture(t, 25);
  // The commit the fixture already has isn't the agent's: nothing new lands, so the wait times out.
  assert.equal(await changes.confirmCommit('w1', undefined, 150), undefined);
  const landed = changes.confirmCommit('w1', undefined, 10_000);
  // The agent commits while the office waits; give it a moment to note the HEAD it started from.
  await new Promise((r) => setTimeout(r, 150));
  writeFileSync(path.join(dir, 'flux.ts'), 'export const flux = 1;\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'Add the flux capacitor');
  assert.equal(await landed, 'Add the flux capacitor');
});
