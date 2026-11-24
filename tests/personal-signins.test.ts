import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SignIns } from '../src/server/signins.js';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-personal-signins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const host = {
    PATH: process.env.PATH ?? '', HOME: path.join(dir, 'host'), XDG_CONFIG_HOME: path.join(dir, 'host-config'),
    ANTHROPIC_API_KEY: 'synthetic-host', ANTHROPIC_AUTH_TOKEN: 'synthetic-host', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-host',
    CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'host', AWS_SHARED_CREDENTIALS_FILE: '/host/credentials',
    KIMI_API_KEY: 'synthetic-host', KIMI_BASE_URL: 'https://host.invalid', KIMI_CODE_HOME: '/host/kimi',
    OPENAI_API_KEY: 'synthetic-host', CODEX_HOME: '/host/codex', CODEX_ACCESS_TOKEN: 'synthetic-host',
    CURSOR_API_KEY: 'synthetic-host', GROK_AUTH_PATH: '/host/grok-auth', OPENCODE_CONFIG_CONTENT: '{"host":"credentials"}',
    GH_TOKEN: 'synthetic-host', GIT_CONFIG_GLOBAL: path.join(dir, 'host.gitconfig'),
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: 'Authorization: synthetic-host',
    SSH_AUTH_SOCK: '/host/agent.sock', BASH_ENV: '/host/startup', ZDOTDIR: '/host', NODE_OPTIONS: '--require=/host/startup.js',
  };
  const make = () => new SignIns(dir, null, process.execPath, null, null, () => ({ ...host }), () => true, () => {});
  const save = (id: string, data: unknown) => {
    const home = path.join(dir, 'homes', id);
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, 'signins.json'), JSON.stringify(data), { mode: 0o600 });
    return home;
  };
  return { dir, host, make, save };
}

test('two named accounts get distinct native roots and no ambient host provider credentials', (t) => {
  const f = fixture(t); const signins = f.make();
  const original = { ...f.host };
  for (const id of ['alice01', 'bob0001']) {
    const env = signins.apply(id, { ...f.host });
    const home = path.join(f.dir, 'homes', id);
    assert.equal(env.HOME, home);
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(home, 'claude'));
    assert.equal(env.KIMI_CODE_HOME, path.join(home, 'kimi'));
    assert.equal(env.CODEX_HOME, path.join(home, 'codex'));
    assert.equal(env.GH_CONFIG_DIR, path.join(home, 'gh'));
    assert.equal(env.XDG_CONFIG_HOME, path.join(home, '.config'));
    for (const key of ['CURSOR_API_KEY', 'GROK_AUTH_PATH', 'OPENCODE_CONFIG_CONTENT']) assert.equal(env[key], undefined, key);
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE', 'KIMI_API_KEY', 'KIMI_BASE_URL', 'OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN', 'GH_TOKEN', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'SSH_AUTH_SOCK', 'BASH_ENV', 'NODE_OPTIONS']) assert.equal(env[key], undefined, key);
    assert.equal(env.PATH, f.host.PATH);
  }
  assert.deepEqual(f.host, original);
});

test('legacy office selections and cached host identities never authorize a personal launch', async (t) => {
  const f = fixture(t);
  const home = f.save('alice01', { claude: { use: 'office' }, kimi: { use: 'office' }, codex: { use: 'office' }, github: { use: 'office' }, seen: { claude: 'host', kimi: 'host', codex: 'host', github: 'host' } });
  const signins = f.make();
  for (const kind of ['claude', 'kimi', 'codex', 'github'] as const) {
    assert.equal(signins.ready('alice01', kind), false);
    assert.equal(signins.state('alice01')[kind].how, 'login');
    assert.equal(signins.state('alice01')[kind].status, 'none');
    assert.match(signins.useOffice('alice01', kind), /Sign in to/);
  }
  assert.equal(signins.state('alice01').office, false);
  assert.equal(signins.apply('alice01', { ...f.host }).KIMI_API_KEY, undefined);
  // Native login was already present: inspecting the PERSONAL root recognizes it without another login.
  mkdirSync(path.join(home, 'kimi', 'credentials'), { recursive: true });
  const credential = path.join(home, 'kimi', 'credentials', 'dummy.json');
  writeFileSync(credential, '{"dummy":"personal"}');
  await signins.look('alice01', true);
  assert.equal(signins.ready('alice01', 'kimi'), true);
  assert.equal(readFileSync(credential, 'utf8'), '{"dummy":"personal"}');
});

test('existing own credentials remain ready and their provider session files remain unchanged', (t) => {
  const f = fixture(t);
  const home = f.save('alice01', { seen: { claude: 'own Claude', kimi: 'own Kimi', codex: 'own ChatGPT' } });
  for (const sub of ['claude', 'kimi', 'codex']) {
    mkdirSync(path.join(home, sub, 'sessions'), { recursive: true });
    writeFileSync(path.join(home, sub, 'sessions', 'native.json'), '{"session":"retained"}');
  }
  const signins = f.make();
  signins.apply('alice01', { ...f.host });
  for (const kind of ['claude', 'kimi', 'codex'] as const) {
    assert.equal(signins.ready('alice01', kind), true);
    assert.equal(readFileSync(path.join(home, kind, 'sessions', 'native.json'), 'utf8'), '{"session":"retained"}');
  }
});

test('each account’s explicit token is used only for that account, including sign-in probes', (t) => {
  const f = fixture(t);
  f.save('alice01', { claude: { use: 'token', token: 'sk-ant-oat01-synthetic-alice' }, kimi: { use: 'token', token: 'synthetic-alice' } });
  f.save('bob0001', { claude: { use: 'token', token: 'sk-ant-oat01-synthetic-bob' }, kimi: { use: 'token', token: 'synthetic-bob' } });
  const signins = f.make();
  for (const [id, name] of [['alice01', 'alice'], ['bob0001', 'bob']]) {
    const env = signins.apply(id, { ...f.host });
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, `sk-ant-oat01-synthetic-${name}`);
    assert.equal(env.KIMI_API_KEY, `synthetic-${name}`);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    const probe = signins.apply(id, { ...f.host }, [], 'claude');
    assert.equal(probe.KIMI_API_KEY, undefined);
    assert.equal(probe.CODEX_HOME, path.join(f.dir, 'homes', id, 'codex'));
  }
});

test('generated personal git config migrates host includes with backup and keeps personal identity', (t) => {
  const f = fixture(t); const home = f.save('alice01', {});
  writeFileSync(f.host.GIT_CONFIG_GLOBAL, '[http]\n\textraHeader = Authorization: synthetic-host\n[credential]\n\thelper = !host-helper\n');
  const old = `# Written by Agent Office: git for this account, on top of the office machine’s own settings.\n[include]\n\tpath = "${f.host.GIT_CONFIG_GLOBAL}"\n[user]\n\tname = Alice\n[credential "https://github.com"]\n\thelper =\n\thelper = !personal-helper\n`;
  writeFileSync(path.join(home, 'gitconfig'), old);
  const env = f.make().apply('alice01', { ...f.host });
  assert.equal(spawnSync('git', ['config', '--global', '--get-all', 'http.extraHeader'], { env }).status, 1);
  assert.equal(spawnSync('git', ['config', '--global', '--get-all', 'credential.helper'], { env }).status, 1);
  assert.equal(execFileSync('git', ['config', '--global', '--get', 'user.name'], { env, encoding: 'utf8' }).trim(), 'Alice');
  assert.match(execFileSync('git', ['config', '--global', '--get-all', 'credential.https://github.com.helper'], { env, encoding: 'utf8' }), /personal-helper/);
  const backups = readdirSync(home).filter((name) => name.startsWith('gitconfig.before-personal-'));
  assert.equal(backups.length, 1); assert.equal(readFileSync(path.join(home, backups[0]), 'utf8'), old);
  f.make().apply('alice01', { ...f.host });
  assert.equal(readdirSync(home).filter((name) => name.startsWith('gitconfig.before-personal-')).length, 1);
});
