import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { roster } from '../src/server/cubbies/local/roster.js';
import { processes } from '../src/server/cubbies/local/processes.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';

function fixture(t: any) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-roster-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo'), tree = path.join(home, 'tree'), outside = path.join(home, 'repo-other');
  for (const dir of [project, tree, outside]) mkdirSync(dir);
  const config: LocalConfig = { floor: 'f', project, roots: [project, tree], branches: new Map([[project, 'main'], [tree, 'work']]),
    state: home, computerId: 'computer', provider: 'claude', session: 'session', executable: 'unused', claudeHome: home, fresh: false };
  return { home, config, project, tree, outside };
}

test('process scan uses executable names only, canonical exact roots and real worktrees; reports unknown on inspection failure', async (t) => {
  const f = fixture(t); const alias = path.join(f.home, 'alias'); symlinkSync(f.tree, alias);
  const calls: string[][] = [];
  const scan = await processes(f.config.roots, async (bin, args) => {
    calls.push([bin, ...args]);
    if (bin === 'ps') return '10 1 /bin/claude\n11 1 /bin/codex\n12 1 /bin/kimi\n13 1 /bin/other';
    return 'p' + args[2] + '\nn' + ({ '10': f.project, '11': alias, '12': f.outside } as any)[args[2]] + '\n';
  });
  assert.equal(scan.complete, true); assert.deepEqual(scan.processes.map((p) => p.tool).sort(), ['claude', 'codex']);
  assert.ok(calls.every((args) => !args.includes('args') && !args.includes('command')));
  const unknown = await processes(f.config.roots, async () => { throw new Error('SECRET'); });
  assert.equal(unknown.complete, false);
});

test('factory, Paradev and direct sources dedupe process/session; only canonical scoped metadata leaves', async (t) => {
  const f = fixture(t);
  const factory = path.join(f.home, 'Library/Application Support/AgentHarness/factory'); mkdirSync(factory, { recursive: true });
  writeFileSync(path.join(factory, 'active-run.json'), JSON.stringify({ repository: f.project, worktree: f.tree, pid: 10, phase: 'running', builder: 'codex',
    taskIds: ['T001'], branch: 'work', deadline: 1234, prompt: 'SECRET', transcript: 'SECRET' }));
  const boards = path.join(f.project, '.agent-office'); mkdirSync(boards);
  writeFileSync(path.join(boards, 'cubby.json'), JSON.stringify({ plan: ['Explicit plan'], needsYou: ['Explicit decision'], hidden: 'SECRET' }));
  writeFileSync(path.join(f.project, 'STATUS.md'), 'SECRET random markdown never read');
  const result = await roster(f.config, { home: f.home, scan: async () => ({ complete: true, processes: [
    { pid: 11, ppid: 10, tool: 'codex', cwd: f.tree },
    { pid: 20, ppid: 1, tool: 'claude', cwd: f.project },
    { pid: 30, ppid: 1, tool: 'kimi', cwd: f.project },
  ] }), run: async (_bin, args) => {
    if (args[0] === 'projects') return JSON.stringify([{ id: 'project', path: f.project }, { id: 'outside', path: f.outside }]);
    if (args[0] === 'workspaces') { assert.equal(args[4], 'project'); return JSON.stringify([{ id: 'workspace', worktreePath: f.project }]); }
    return JSON.stringify([{ id: 'chat', pid: 20, provider: 'claude', providerSessionId: 's', status: 'idle', title: 'SECRET prompt' },
      { id: 'duplicate', provider: 'claude', providerSessionId: 's' }]);
  } });
  assert.equal(result.agents.length, 3); assert.deepEqual(result.agents.map((a) => a.role), ['factory', 'paradev', 'direct']);
  assert.equal(result.agents[2].status, 'unknown'); assert.deepEqual(result.plan, ['Explicit plan']); assert.deepEqual(result.needsYou, ['Explicit decision']);
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.ok(!JSON.stringify(result).includes(f.project));
});

test('roster snapshot bounds agent count/bytes and keeps unverified sources visibly unknown', async (t) => {
  const f = fixture(t);
  const result = await roster(f.config, { home: f.home, scan: async () => ({ complete: false, processes:
    Array.from({ length: 300 }, (_, i) => ({ pid: i + 10, ppid: 1, tool: 'claude', cwd: f.project })) }),
    run: async () => { throw new Error('SECRET API credential'); } });
  assert.equal(result.agents.length, 128); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024);
  assert.match(result.error!, /coverage unavailable/); assert.ok(!result.error!.includes('SECRET'));
});
