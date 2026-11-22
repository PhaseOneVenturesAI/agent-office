// The hygiene watchdog: finding unpushed work and stale worktrees, and pruning only what's safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneStale, scanRepo } from '../src/server/hygiene.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A checkout whose pushes land in a local bare repository, with one commit on main. */
function setup(): { base: string; dir: string; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-hygiene-'));
  const bare = path.join(base, 'remote.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  const dir = path.join(base, 'project');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), '# project\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return { base, dir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

const commit = (dir: string, name: string) => {
  writeFileSync(path.join(dir, name), `${name}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', name);
};

test('unpushed branches and stale worktrees are found; owned ones are not', async () => {
  const { dir, cleanup } = setup();
  try {
    // A branch with two commits no remote has.
    git(dir, 'checkout', '-q', '-b', 'office/mochi-a1b2');
    commit(dir, 'a.ts');
    commit(dir, 'b.ts');
    // A branch that's fully pushed.
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'checkout', '-q', '-b', 'safe');
    commit(dir, 'c.ts');
    git(dir, 'push', '-q', 'origin', 'safe');
    git(dir, 'checkout', '-q', 'main');

    // A worktree no worker uses (stale), and one a worker still sits in (owned).
    git(dir, 'worktree', 'add', '-q', path.join(dir, '.agent-office', 'worktrees', 'mochi-a1b2'), 'office/mochi-a1b2');
    git(dir, 'checkout', '-q', '-b', 'office/pip-c3d4');
    commit(dir, 'd.ts');
    git(dir, 'push', '-q', 'origin', 'office/pip-c3d4');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'worktree', 'add', '-q', path.join(dir, '.agent-office', 'worktrees', 'pip-c3d4'), 'office/pip-c3d4');

    const owned = new Set([path.normalize(path.join('.agent-office', 'worktrees', 'pip-c3d4'))]);
    const ownedBranches = new Set(['office/pip-c3d4']);
    const scan = await scanRepo(dir, owned, ownedBranches);

    assert.deepEqual(scan.unpushed, [{ branch: 'office/mochi-a1b2', commits: 2 }], 'only the unpushed branch, with its count');
    assert.deepEqual(scan.stale.map((s) => s.path), [path.join('.agent-office', 'worktrees', 'mochi-a1b2')], 'only the worktree nobody uses');
  } finally {
    cleanup();
  }
});

test('pruning takes clean stale worktrees and keeps anything holding work', async () => {
  const { dir, cleanup } = setup();
  try {
    // Clean stale worktree on an office branch that is fully pushed: goes, branch and all.
    git(dir, 'checkout', '-q', '-b', 'office/clean-0001');
    commit(dir, 'clean.ts');
    git(dir, 'push', '-q', 'origin', 'office/clean-0001');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'worktree', 'add', '-q', path.join(dir, '.agent-office', 'worktrees', 'clean-0001'), 'office/clean-0001');

    // Stale worktree with an uncommitted file: kept.
    git(dir, 'checkout', '-q', '-b', 'office/dirty-0002');
    commit(dir, 'dirty.ts');
    git(dir, 'push', '-q', 'origin', 'office/dirty-0002');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'worktree', 'add', '-q', path.join(dir, '.agent-office', 'worktrees', 'dirty-0002'), 'office/dirty-0002');
    writeFileSync(path.join(dir, '.agent-office', 'worktrees', 'dirty-0002', 'wip.ts'), 'not committed\n');

    // Stale worktree with commits no remote has: kept.
    git(dir, 'checkout', '-q', '-b', 'office/ahead-0003');
    commit(dir, 'ahead.ts');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'worktree', 'add', '-q', path.join(dir, '.agent-office', 'worktrees', 'ahead-0003'), 'office/ahead-0003');

    const stale = [
      { path: path.join('.agent-office', 'worktrees', 'clean-0001'), branch: 'office/clean-0001' },
      { path: path.join('.agent-office', 'worktrees', 'dirty-0002'), branch: 'office/dirty-0002' },
      { path: path.join('.agent-office', 'worktrees', 'ahead-0003'), branch: 'office/ahead-0003' },
    ];
    const { removed, kept } = await pruneStale(dir, stale);

    assert.deepEqual(removed, [path.join('.agent-office', 'worktrees', 'clean-0001')]);
    assert.equal(git(dir, 'branch', '--list', 'office/clean-0001'), '', 'its clean office branch went too');
    assert.deepEqual(
      kept.map((k) => k.why),
      ['it has uncommitted changes', 'it has 1 commit no remote has'],
    );
  } finally {
    cleanup();
  }
});
