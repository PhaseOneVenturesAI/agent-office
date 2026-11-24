import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexQaAuth } from '../src/server/staff-qa-codex-auth.js';
import { codexStaffQaAsk, runCodexQa } from '../src/server/staff-qa-codex.js';
import { CODEX_QA_MODEL, CODEX_QA_CATALOG, codexQaModelProblem } from '../src/server/staff-qa-codex-config.js';
import { floorStaffQA } from '../src/server/dept-staff-qa.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'codex-qa-test-'));
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'selected-account', chatgpt_plan_type: 'pro' } })).toString('base64url')}.dummy`;
  const auth = { auth_mode: 'chatgpt', tokens: { access_token: token, id_token: token, refresh_token: 'CANONICAL_REFRESH_NEVER_COPY', account_id: 'selected-account' } };
  writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(auth));
  writeFileSync(path.join(dir, 'AGENTS.md'), 'PRIVATE_MANAGER_INSTRUCTIONS');
  writeFileSync(path.join(dir, 'config.toml'), 'model_provider="private-provider"\n');
  const probe = path.join(dir, 'probe.json');
  const file = path.join(dir, 'fake-codex');
  writeFileSync(file, `#!${process.execPath}
import fs from 'node:fs';
if(process.argv.includes('--version')) { console.log('codex-cli 0.171.0'); process.exit(0); }
let prompt='';for await (const c of process.stdin) prompt+=c;
const home=process.env.CODEX_HOME;
fs.writeFileSync(${JSON.stringify(probe)},JSON.stringify({env:process.env,cwd:process.cwd(),args:process.argv.slice(2),prompt,config:fs.readFileSync(home+'/config.toml','utf8'),auth:JSON.parse(fs.readFileSync(home+'/auth.json','utf8')),files:fs.readdirSync(home)}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Approved snapshot answer.'}}));
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o700 });
  return { dir, file, probe, auth, env: { PATH: process.env.PATH!, CODEX_HOME: dir }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('access snapshot is external ChatGPT auth and never contains a renewable credential', () => {
  const f = fixture();
  try {
    const before = readFileSync(path.join(f.dir, 'auth.json'), 'utf8');
    const result = codexQaAuth(f.dir);
    assert.notEqual(typeof result, 'string');
    assert.equal((result as any).auth_mode, 'chatgptAuthTokens');
    assert.equal((result as any).tokens.refresh_token, '');
    assert.equal(JSON.stringify(result).includes('CANONICAL_REFRESH'), false);
    assert.equal(readFileSync(path.join(f.dir, 'auth.json'), 'utf8'), before);
    assert.match(String(codexQaAuth(f.dir, Date.now() + 3600_000)), /needs refreshing/);
    writeFileSync(path.join(f.dir, 'auth.json'), JSON.stringify({ ...f.auth, OPENAI_API_KEY: 'sk-dummy' }));
    assert.match(String(codexQaAuth(f.dir)), /API keys/);
    writeFileSync(path.join(f.dir, 'auth.json'), JSON.stringify({ ...f.auth, tokens: { ...f.auth.tokens, account_id: 'other' } }));
    assert.match(String(codexQaAuth(f.dir)), /inconsistent/);
  } finally { f.cleanup(); }
});

test('unknown models and inherited provider/runtime configuration are refused before launch', async () => {
  const f = fixture();
  try {
    for (const model of [undefined, 'gpt-6.2-astra', 'gpt-6.2-sol-preview']) assert.ok(codexQaModelProblem(model));
    for (const env of [{ ...f.env, OPENAI_API_KEY: 'sk-dummy' }, { ...f.env, OPENAI_BASE_URL: 'https://evil.invalid' }, { ...f.env, CODEX_ACCESS_TOKEN: 'dummy' }, { ...f.env, NODE_OPTIONS: '--inspect' }, { PATH: process.env.PATH! }]) {
      const result = await codexStaffQaAsk({ file: f.file, env, model: CODEX_QA_MODEL, prompt: 'q' });
      assert.equal(result.ok, false);
    }
    assert.equal((await codexStaffQaAsk({ file: f.file, env: f.env, model: 'unknown', prompt: 'q' })).ok, false);
    assert.equal(existsSync(f.probe), false);
  } finally { f.cleanup(); }
});

test('Codex Q&A uses fresh config/home/cwd and deletes them without changing canonical credentials', async () => {
  const f = fixture();
  try {
    const before = readFileSync(path.join(f.dir, 'auth.json'), 'utf8');
    const outcome = await codexStaffQaAsk({ file: f.file, env: f.env, model: CODEX_QA_MODEL, prompt: 'APPROVED_SNAPSHOT' });
    assert.deepEqual(outcome, { ok: true, answer: 'Approved snapshot answer.' });
    const probe = JSON.parse(readFileSync(f.probe, 'utf8'));
    assert.notEqual(probe.cwd, f.dir);
    assert.equal(probe.env.CODEX_HOME, probe.env.HOME);
    assert.equal(existsSync(probe.env.HOME), false);
    assert.equal(existsSync(probe.cwd), false);
    assert.equal(probe.auth.tokens.refresh_token, '');
    assert.equal(probe.auth.tokens.account_id, 'selected-account');
    assert.equal(probe.prompt, 'APPROVED_SNAPSHOT');
    assert.equal(probe.args.includes('--ephemeral'), true);
    assert.equal(probe.args.includes('resume'), false);
    assert.equal(probe.files.includes('AGENTS.md'), false);
    assert.match(probe.config, /model_provider = "openai"/);
    assert.match(probe.config, /shell_tool = false/);
    assert.match(probe.config, /project_doc_max_bytes = 0/);
    assert.doesNotMatch(probe.config, /private-provider|credential_masking = false|base_url/);
    assert.equal(readFileSync(path.join(f.dir, 'auth.json'), 'utf8'), before);
    const model = CODEX_QA_CATALOG.models[0];
    assert.equal(model.slug, CODEX_QA_MODEL);
    assert.equal(model.shell_type, 'disabled');
    assert.equal(model.apply_patch_tool_type, null);
    assert.deepEqual(model.experimental_supported_tools, []);
    assert.equal(model.tool_mode, 'direct');
  } finally { f.cleanup(); }
});

test('Q&A refuses changed CLI versions and transport tool activity, timeout and output flooding', async () => {
  const f = fixture();
  try {
    writeFileSync(f.file, '#!/bin/sh\necho codex-cli 0.171.0-alpha.13\n');
    assert.equal((await codexStaffQaAsk({ file: f.file, env: f.env, model: CODEX_QA_MODEL, prompt: 'q' })).ok, false);
    for (const code of [
      `console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));setInterval(()=>{},1000)`,
      `process.stdout.write('x'.repeat(1000001));setInterval(()=>{},1000)`,
      `setInterval(()=>{},1000)`,
      `console.log('not json')`,
      `console.log(JSON.stringify({type:'turn.failed',error:{message:'SECRET_MUST_NOT_REACH_STAFF'}}));process.exit(1)`,
    ]) {
      const result = await runCodexQa({ file: process.execPath, args: ['-e', code], cwd: f.dir, env: { PATH: process.env.PATH }, prompt: 'q', timeoutMs: 200 });
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes('SECRET_MUST_NOT_REACH_STAFF'), false);
    }
  } finally { f.cleanup(); }
});

test('floor dispatcher preserves selected custody, approved snapshot and separate QA history', async () => {
  const f = fixture();
  try {
    const calls: unknown[] = [];
    const history: unknown[] = [];
    const floor = { dir: f.dir, dataDir: f.dir, accountsEnabled: () => true,
      departments: { get: () => ({ name: 'Research', policy: { provider: 'codex', model: CODEX_QA_MODEL }, brief: [{ rev: 1, text: 'Approved brief' }], assets: [] }) },
      runAs: { ready: () => true, why: () => 'login needed', apply: (id: string, env: Record<string,string>, dirs: string[], provider: string) => { calls.push({ id, dirs, provider }); env.CODEX_HOME = f.dir; return env; } },
      roleChat: { append: (id: string, message: unknown) => history.push({ id, message }) },
    };
    assert.equal((await floorStaffQA(floor as never, 'dept', 'q', 'Staff', undefined, { file: f.file, args: [] })).ok, false);
    const answer = await floorStaffQA(floor as never, 'dept', 'q', 'Staff', 'custodian01', { file: f.file, args: [] });
    assert.equal(answer.ok, true);
    assert.deepEqual(calls, [{ id: 'custodian01', dirs: [], provider: 'codex' }]);
    assert.equal(history.length, 2);
    assert.ok(history.every((row: any) => row.id === 'qa-dept'));
    const probe = JSON.parse(readFileSync(f.probe, 'utf8'));
    assert.match(probe.prompt, /Approved brief/);
    assert.doesNotMatch(probe.prompt, /PRIVATE_MANAGER/);
  } finally { f.cleanup(); }
});
