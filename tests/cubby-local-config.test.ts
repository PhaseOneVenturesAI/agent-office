import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configure, persistSelection } from '../src/server/cubbies/local/config.js';
import { projectLock } from '../src/server/cubbies/local/lock.js';
import { nativeEnv } from '../src/server/cubbies/local/io.js';

const session = '12345678-1234-1234-1234-123456789abc';
function fixture(t: any) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-config-')));
  const project = path.join(home, 'repo'), worktree = path.join(home, 'worktree'), common = path.join(project, '.git');
  mkdirSync(common, { recursive: true }); mkdirSync(worktree);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const execute = async (_bin: string, args: string[]) => args.includes('--show-toplevel') ? project
    : args.includes('--git-common-dir') ? common : `worktree ${project}\0branch refs/heads/main\0\0worktree ${worktree}\0branch refs/heads/feature\0\0`;
  const registry = (entry: any) => { const dir = path.join(home, 'Documents/AgentHarness'); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ projects: { Example: { path: project, ...entry } } })); };
  return { home, project, worktree, execute, registry };
}

test('registry maps native Codex thread UUID; computer identity stable, historical lead ignored, conflicts rejected', async (t) => {
  const f = fixture(t); f.registry({ leadThreadId: session, historicalLead: { providerSessionId: 'old' }, localState: 'present' });
  const a = await configure({ floor: 'floor', project: f.project }, f.home, f.execute);
  const b = await configure({ floor: 'floor', project: f.project }, f.home, f.execute);
  assert.equal(a.session, session); assert.equal(a.provider, 'codex'); assert.equal(a.computerId, b.computerId);
  assert.deepEqual(a.roots, [f.project, f.worktree]);
  await assert.rejects(configure({ floor: 'floor', project: f.project, provider: 'claude' }, f.home, f.execute), /conflict/);
  await assert.rejects(configure({ floor: 'floor', project: f.project, newLead: true }, f.home, f.execute), /conflict/);
  f.registry({ localState: 'archived', leadThreadId: session });
  await assert.rejects(configure({ floor: 'floor', project: f.project }, f.home, f.execute), /archived/);
  f.registry({ historicalLead: { providerSessionId: session }, localState: 'present' });
  await assert.rejects(configure({ floor: 'floor', project: f.project, provider: 'claude', newLead: true }, f.home, f.execute), /no confirmed active lead/);
});

test('new lead requires explicit local authorization and persists one UUID/account per project', async (t) => {
  const f = fixture(t);
  await assert.rejects(configure({ floor: 'f', project: f.project, provider: 'claude' }, f.home, f.execute), /existing/);
  const a = await configure({ floor: 'f', project: f.project, provider: 'claude', newLead: true, profile: 'phase-one' }, f.home, f.execute);
  const release = projectLock(a.state); persistSelection(a); release();
  const b = await configure({ floor: 'f', project: f.project }, f.home, f.execute);
  assert.equal(a.session, b.session); assert.equal(b.executable, 'claude-phase-one'); assert.equal(b.fresh, true);
  await assert.rejects(configure({ floor: 'f', project: f.project, profile: 'personal' }, f.home, f.execute), /profile/);
  const record = JSON.parse(readFileSync(path.join(a.state, 'session.json'), 'utf8')); assert.equal(record.authorizedNew, true);
});

test('project lock excludes another connector, recovers dead PID and releases only its owner marker', (t) => {
  const f = fixture(t), state = path.join(f.home, 'state');
  const release = projectLock(state);
  assert.throws(() => projectLock(state), /busy/); release();
  mkdirSync(path.join(state, 'lead.lock'));
  writeFileSync(path.join(state, 'lead.lock', '99999-12345678-1234-1234-1234-123456789abc'), '');
  const recovered = projectLock(state, (pid) => pid !== 99999); recovered();
  const final = projectLock(state); final();
});

test('native environment strips API routing and inherited approval overrides, preserving local profile paths', () => {
  const env = nativeEnv({ PATH: '/bin', HOME: '/home', ANTHROPIC_API_KEY: 'secret', OPENAI_BASE_URL: 'https://secret',
    CLAUDE_CODE_PERMISSION_MODE: 'bypassPermissions', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/native', AGENT_OFFICE_NODE_TOKEN: 'secret' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/home', CLAUDE_CONFIG_DIR: '/native' });
});

test('the harness registry is read from ~/Documents/GitHub/AgentHarness, falling back to ~/Documents/AgentHarness', async (t) => {
  const { registryFile } = await import('../src/server/cubbies/local/config.js');
  const f = fixture(t);
  assert.equal(registryFile(f.home), path.join(f.home, 'Documents/GitHub/AgentHarness/projects.json'), 'new location when neither exists');
  f.registry({ leadSessionId: session });
  assert.equal(registryFile(f.home), path.join(f.home, 'Documents/AgentHarness/projects.json'), 'old location while only it exists');
  const dir = path.join(f.home, 'Documents/GitHub/AgentHarness'); mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ projects: { Example: { path: f.project, leadThreadId: session } } }));
  assert.equal(registryFile(f.home), path.join(dir, 'projects.json'), 'new location wins once it exists');
  const c = await configure({ floor: 'floor', project: f.project }, f.home, f.execute);
  assert.equal(c.provider, 'codex', 'the entry comes from the new registry');
});
