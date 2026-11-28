import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { githubRemote, originRepo } from '../src/server/hq/local/origin.js';
import { macEntries } from '../src/server/hq/local/snapshot.js';
function dir(t: any) { mkdirSync('.paradev', { recursive: true }); const d = mkdtempSync(path.resolve('.paradev/origin-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }
const config = (url: string) => `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/someone/else.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;

test('GitHub remotes in https, ssh and scp form give owner/repo; other hosts give nothing', () => {
  for (const url of ['https://github.com/PhaseOneVenturesAI/agent-office.git', 'https://github.com/PhaseOneVenturesAI/agent-office', 'git@github.com:PhaseOneVenturesAI/agent-office.git', 'ssh://git@github.com/PhaseOneVenturesAI/agent-office.git', 'https://x-token@github.com/PhaseOneVenturesAI/agent-office.git'])
    assert.equal(githubRemote(url), 'PhaseOneVenturesAI/agent-office', url);
  for (const url of ['https://gitlab.com/a/b.git', 'https://office.phaseone.dev', '/srv/repo.git', 'https://github.com/a']) assert.equal(githubRemote(url), undefined, url);
});

test('origin is read from .git/config, from a worktree via commondir, and only for absolute paths', t => {
  const main = dir(t); mkdirSync(path.join(main, '.git/worktrees/w'), { recursive: true });
  writeFileSync(path.join(main, '.git/config'), config('git@github.com:PhaseOneVenturesAI/agent-office.git'));
  assert.equal(originRepo(main), 'PhaseOneVenturesAI/agent-office');
  const wt = path.join(main, 'wt'); mkdirSync(wt);
  writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git/worktrees/w')}\n`);
  writeFileSync(path.join(main, '.git/worktrees/w/commondir'), '../..\n');
  assert.equal(originRepo(wt), 'PhaseOneVenturesAI/agent-office');
  assert.equal(originRepo('relative/path'), undefined);
  assert.equal(originRepo(dir(t)), undefined, 'no git checkout');
});

test('a project whose url is not GitHub takes its repo from the checkout origin, so it matches its floor', t => {
  const repo = dir(t); mkdirSync(path.join(repo, '.git'));
  writeFileSync(path.join(repo, '.git/config'), config('https://github.com/PhaseOneVenturesAI/agent-office.git'));
  const [row] = macEntries({ projects: { 'Agent Office': { path: repo, url: 'https://office.phaseone.dev', leadSessionId: '11111111-1111-4111-8111-111111111111' } } });
  assert.equal(row.project.repo, 'PhaseOneVenturesAI/agent-office');
  const [gh] = macEntries({ projects: { Plimbo: { path: repo, url: 'https://github.com/PhaseOneVenturesAI/Plimbo' } } });
  assert.equal(gh.project.repo, 'PhaseOneVenturesAI/Plimbo', 'a GitHub url still wins');
});
