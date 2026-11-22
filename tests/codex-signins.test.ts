// Codex as a sign-in kind: its device-code output parser, its credentials check, and the
// per-account CODEX_HOME its workers run with (see server/signins.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexSignedIn, defaultCodexHome, findCodex } from '../src/server/signin-flows.js';
import { SignIns } from '../src/server/signins.js';

const DEVICE_OUT = `
Welcome to Codex [v0.171.0]

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m

2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m
   \x1b[94mXBRY-7F3SG\x1b[0m
`;

function tmp() {
  return mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-signin-'));
}

/** A `codex` stand-in: device login prints and waits, the rest answer from CODEX_HOME. */
function fakeCodex(dir: string): string {
  const bin = path.join(dir, 'codex');
  writeFileSync(
    bin,
    `#!/bin/sh
case "$1 $2" in
  "login --with-api-key")
    read -r key || exit 1
    [ -n "$key" ] || exit 1
    mkdir -p "$CODEX_HOME" && printf '{"key":"%s"}' "$key" > "$CODEX_HOME/auth.json"
    exit 0 ;;
  "login status")
    if [ -f "$CODEX_HOME/auth.json" ]; then echo "Logged in using ChatGPT (me@example.com)"; else echo "Not logged in"; fi
    exit 0 ;;
  "login --device-auth"|"login --device")
    cat <<'OUT'
${DEVICE_OUT}
OUT
    exec sleep 60
    exit 1 ;;
  "logout ")
    rm -f "$CODEX_HOME/auth.json"
    exit 0 ;;
esac
exit 1
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function makeSignIns(dataDir: string, codex: string | null, admin = false) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'agent-office-codex-base-'));
  return new SignIns(dataDir, null, null, codex, null, () => ({ HOME: home, PATH: process.env.PATH ?? '' }), () => admin, () => {});
}

test('findCodex reads the code and page out of codex login --device-auth output', () => {
  assert.deepEqual(findCodex(DEVICE_OUT), { url: 'https://auth.openai.com/codex/device', code: 'XBRY-7F3SG' });
  assert.equal(findCodex('nothing yet'), undefined);
});

test('codexSignedIn goes by auth.json in the CODEX_HOME', () => {
  const dir = tmp();
  assert.equal(codexSignedIn(dir), false);
  writeFileSync(path.join(dir, 'auth.json'), '{}');
  assert.equal(codexSignedIn(dir), true);
  assert.equal(defaultCodexHome({}), path.join(os.homedir(), '.codex'));
  assert.equal(defaultCodexHome({ CODEX_HOME: '/x' }), '/x');
});

test('a pasted OpenAI API key signs the account in, in its own CODEX_HOME', async () => {
  const dataDir = tmp();
  const signins = makeSignIns(dataDir, fakeCodex(tmp()));
  assert.equal(await signins.token('acct01', 'codex', 'not-a-key'), "That isn't an OpenAI API key (sk-…): make one at platform.openai.com/api-keys");
  assert.equal(await signins.token('acct01', 'codex', `sk-${'a'.repeat(40)}`), undefined);
  const state = signins.state('acct01');
  assert.equal(state.codex.status, 'ok');
  assert.equal(state.codex.how, 'login');
  assert.equal(state.codex.who, 'me@example.com');
  assert.equal(signins.ready('acct01', 'codex'), true);
  // The key landed in the account's own home, never the machine's.
  const auth = path.join(dataDir, 'homes', 'acct01', 'codex', 'auth.json');
  assert.ok(existsSync(auth));
  assert.match(readFileSync(auth, 'utf8'), /sk-aaa/);
});

test("a worker's environment gets the account's CODEX_HOME, scrubbed of the machine's OpenAI keys", async () => {
  const dataDir = tmp();
  const signins = makeSignIns(dataDir, fakeCodex(tmp()));
  await signins.token('acct01', 'codex', `sk-${'a'.repeat(40)}`);
  const env = signins.apply('acct01', { OPENAI_API_KEY: 'sk-machine', CODEX_HOME: '/machine', PATH: '/bin' });
  assert.equal(env.CODEX_HOME, path.join(dataDir, 'homes', 'acct01', 'codex'));
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.PATH, '/bin');
});

test('codex device sign-in surfaces the code and page, and cancel stops it', async () => {
  const dataDir = tmp();
  const signins = makeSignIns(dataDir, fakeCodex(tmp()));
  assert.equal(signins.start('acct01', 'codex'), undefined);
  const deadline = Date.now() + 5000;
  let state = signins.state('acct01');
  while (!state.codex.pending?.code && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    state = signins.state('acct01');
  }
  assert.equal(state.codex.pending?.code, 'XBRY-7F3SG');
  assert.equal(state.codex.pending?.url, 'https://auth.openai.com/codex/device');
  signins.cancel('acct01', 'codex');
});

test('without the codex binary the kind reports why, and admins may use the office’s own', async () => {
  const dataDir = tmp();
  const signins = makeSignIns(dataDir, null);
  assert.equal(signins.start('acct01', 'codex'), "Codex isn't installed where the office can run it — paste an OpenAI API key instead");
  assert.equal(await signins.token('acct01', 'codex', `sk-${'a'.repeat(40)}`), "Codex isn't installed where the office can run it");
  await signins.look('acct01', true);
  assert.equal(signins.state('acct01').codex.error, "Codex isn't installed on the office's machine");
  assert.equal(signins.ready('acct01', 'codex'), false);
  const adminSignIns = makeSignIns(dataDir, null, true);
  assert.equal(adminSignIns.useOffice('admin1', 'codex'), undefined);
  assert.equal(adminSignIns.ready('admin1', 'codex'), true);
  assert.equal(adminSignIns.apply('admin1', { OPENAI_API_KEY: 'sk-machine' }).OPENAI_API_KEY, 'sk-machine');
});
