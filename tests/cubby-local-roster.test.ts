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

test('draft publication is bounded and cleaned at both connector and server boundaries', async t => {
  const f = fixture(t), boards = path.join(f.project, '.agent-office'); mkdirSync(boards);
  const raw = { decisions: ['  Decision\u0000\n one  ', ...Array(20).fill('x'.repeat(400))], plan: Array(20).fill('Plan'),
    screens: [{ title: '  Screen\nOne ', status: 'review' }, { title: 'Bad', status: 'published' }, ...Array(30).fill({ title: 's'.repeat(200), status: 'sketch' })],
    brand: { name: ' Brand\u0007 name ', tagline: 't'.repeat(300), colors: ['#AABBCC', '#fff', 'red', '#112233', '#000000', '#ffffff', '#abcdef'] }, secret: 'NEVER PUBLISH' };
  writeFileSync(path.join(boards, 'draft.json'), JSON.stringify(raw));
  const deps = { home: f.home, scan: async () => ({ complete: true, processes: [] }), run: async () => '[]' };
  const result = await roster(f.config, deps), draft = result.draft!;
  assert.equal(draft.decisions.length, 16); assert.equal(draft.plan.length, 16);
  assert.equal(draft.decisions[0], 'Decision one'); assert.equal(draft.decisions[1].length, 300);
  assert.equal(draft.screens.length, 23); assert.equal(draft.screens[0].title, 'Screen One'); assert.equal(draft.screens[1].title.length, 120);
  assert.equal(draft.brand.name, 'Brand name'); assert.equal(draft.brand.tagline!.length, 200);
  assert.deepEqual(draft.brand.colors, ['#aabbcc', '#112233', '#000000', '#ffffff']);
  assert.doesNotMatch(JSON.stringify(result), /NEVER PUBLISH/);
  const { snapshot } = await import('../src/server/cubbies/snapshot.js');
  assert.deepEqual(snapshot({ ...result, draft: raw }, result.observedAt)!.draft, draft);
  assert.deepEqual(snapshot({ ...result, draft: { decisions: [null, {}, 1], screens: [null, {}, { title: 'X', status: null }], brand: null } }, result.observedAt)!.draft,
    { ideas: [], decisions: [], plan: [], screens: [], brand: { colors: [] } });
});

test('draft files use the bounded no-follow reader; bad publications never forward file contents', async t => {
  const f = fixture(t), boards = path.join(f.project, '.agent-office'); mkdirSync(boards);
  const file = path.join(boards, 'draft.json');
  const deps = { home: f.home, scan: async () => ({ complete: true, processes: [] }), run: async () => '[]' };
  for (const text of ['{bad', JSON.stringify({ decisions: ['SECRET'.repeat(12000)] })]) {
    writeFileSync(file, text);
    const result = await roster(f.config, deps);
    assert.equal(result.draft, undefined); assert.match(result.error!, /Draft board record unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  rmSync(file); const outside = path.join(f.outside, 'private.json');
  writeFileSync(outside, JSON.stringify({ decisions: ['SECRET'] })); symlinkSync(outside, file);
  const result = await roster(f.config, deps);
  assert.equal(result.draft, undefined); assert.match(result.error!, /Draft board record unavailable/);
  rmSync(file);
  assert.equal((await roster(f.config, deps)).draft, undefined);
});

test('harness designers retain their builder seat and publish the designer marker', async t => {
  const f = fixture(t), runs = path.join(f.home, 'Library/Application Support/AgentHarness/runs'); mkdirSync(runs, { recursive: true });
  writeFileSync(path.join(runs, '123-ab.json'), JSON.stringify({ schema: 1, pid: 123, folder: f.project, role: 'designer', provider: 'codex', title: 'Draw screens' }));
  const result = await roster(f.config, { home: f.home, isAlive: () => true, scan: async () => ({ complete: true, processes: [] }), run: async () => '[]' });
  assert.equal(result.agents[0].role, 'builder'); assert.equal(result.agents[0].designer, true);
  const { snapshot } = await import('../src/server/cubbies/snapshot.js');
  assert.equal(snapshot(result, result.observedAt)!.agents[0].designer, true);
});
