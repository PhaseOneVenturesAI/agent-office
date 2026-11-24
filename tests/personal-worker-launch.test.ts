import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SignIns } from '../src/server/signins.js';
import { WorkerManager } from '../src/server/workers.js';
import { Ledger } from '../src/server/usage.js';

async function waitFor(check: () => boolean) {
  const until = Date.now() + 5000;
  while (!check() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(check(), 'dummy native worker did not reach expected state');
}

test('default/explicit personal workers and native resume use only their own credentials; missing login fails before launch', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-personal-launch-'));
  const data = path.join(root, 'data'); const binary = path.join(root, 'claude'); const log = path.join(root, 'invocations.jsonl');
  mkdirSync(data); writeFileSync(log, '');
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,claude:process.env.CLAUDE_CONFIG_DIR,token:process.env.CLAUDE_CODE_OAUTH_TOKEN,hostKey:process.env.ANTHROPIC_API_KEY,id:process.env.AGENT_OFFICE_WORKER_ID,hook:process.env.AGENT_OFFICE_HOOK_TOKEN})+'\\n');setTimeout(()=>process.exit(0),150);\n`, { mode: 0o700 });
  const signins = new SignIns(data, null, null, null, null, () => ({ PATH: process.env.PATH ?? '' }), () => true, () => {});
  for (const [id, key] of [['alice01', 'synthetic-alice'], ['bob0001', 'synthetic-bob']]) {
    const home = path.join(data, 'homes', id); mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, 'signins.json'), JSON.stringify({ claude: { use: 'token', token: key } }));
  }
  const ledger = new Ledger(data, { pauseHiring: false }, () => {}, () => {});
  const workers = new WorkerManager(root, data, binary, ['--settings', '/host/settings-with-credentials'], { url: 'http://127.0.0.1:1', token: '' }, { update() {}, remove() {}, data() {}, screen() {}, toast() {} }, ledger, undefined, undefined, signins);
  t.after(async () => { await workers.shutdown(); rmSync(root, { recursive: true, force: true }); });
  assert.match(workers.spawn('desk-1', 'No login', 'Task', false, 'agent', undefined, undefined, undefined, undefined, 'absent1') as string, /Your sign-ins/);
  assert.match(workers.spawn('desk-1', 'Alice', 'Task', false, 'agent', 'grok', undefined, undefined, undefined, 'alice01') as string, /personal sign-in/);
  assert.equal(readFileSync(log, 'utf8'), '');
  const alice = workers.spawn('desk-1', 'Alice', 'Own task', false, 'agent', undefined, undefined, undefined, undefined, 'alice01');
  const bob = workers.spawn('desk-2', 'Bob', 'Own task', false, 'agent', 'claude', undefined, undefined, undefined, 'bob0001');
  assert.notEqual(typeof alice, 'string'); assert.notEqual(typeof bob, 'string');
  if (typeof alice === 'string' || typeof bob === 'string') return;
  const rows = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s));
  await waitFor(() => rows().length === 2);
  for (const [worker, id, token] of [[alice, 'alice01', 'synthetic-alice'], [bob, 'bob0001', 'synthetic-bob']] as const) {
    const row = rows().find((r) => r.id === worker.id);
    assert.equal(row.home, path.join(data, 'homes', id)); assert.equal(row.claude, path.join(row.home, 'claude'));
    assert.equal(row.token, token); assert.equal(row.hostKey, undefined);
    assert.equal(row.args.includes('/host/settings-with-credentials'), false);
    assert.equal(workers.ownerOf(worker.id), id);
  }
  const first = rows().find((r) => r.id === alice.id);
  assert.equal(workers.handleHook(alice.id, first.hook, 'SessionStart', { session_id: 'existing-alice-native-session' }), true);
  await waitFor(() => workers.get(alice.id)?.status === 'exited');
  assert.equal(workers.resume(alice.id), undefined);
  await waitFor(() => rows().length === 3);
  const resumed = rows().at(-1)!;
  assert.equal(resumed.token, 'synthetic-alice');
  assert.ok(resumed.args.includes('--resume')); assert.ok(resumed.args.includes('existing-alice-native-session'));
  assert.equal(resumed.args.includes('/host/settings-with-credentials'), false);
});
