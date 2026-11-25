// The providers' plan limits: the Claude, Codex and Kimi readers and the hub that bundles them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeLimits } from '../src/server/limits/claude.js';
import { codexLimits, parseCodexLimits } from '../src/server/limits/codex.js';
import { kimiLimits, parseKimiLimits } from '../src/server/limits/kimi.js';
import { LimitsHub } from '../src/server/limits/hub.js';

function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-limits-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake CLI the readers can spawn. */
function fakeBin(dir: string, name: string, script: string): string {
  const bin = path.join(dir, name);
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('Codex rate-limit snapshots become the meter’s windows, labeled by their length', () => {
  const resets = 1796022268;
  const s = parseCodexLimits({
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 45, windowDurationMins: 300, resetsAt: resets },
      secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: null },
      planType: 'promax',
    },
  });
  assert.equal(s.plan, 'Pro Max');
  assert.deepEqual(
    s.windows.map((w) => [w.label, w.pct, w.resetsAt]),
    [
      ['5h session', 45, resets * 1000],
      ['Week', 12, undefined],
    ],
  );
  // Odd lengths get a name of their own, percentages are clamped, and junk is no window.
  const odd = parseCodexLimits({ rateLimits: { primary: { usedPercent: 140, windowDurationMins: 1440 }, secondary: { usedPercent: 'x' }, planType: 'self_serve_business_usage_based' } });
  assert.deepEqual(odd.windows.map((w) => [w.label, w.pct]), [['1d limit', 100]]);
  assert.equal(odd.plan, 'Self serve business usag'); // plan names are capped at 24 characters
  assert.deepEqual(parseCodexLimits({ rateLimits: null }).windows, []);
  assert.deepEqual(parseCodexLimits(undefined).windows, []);
});

test('the Codex reader asks its app server over stdio, starting no conversation', async (t) => {
  const dir = tempDir(t);
  const codex = fakeBin(
    dir,
    'codex',
    [
      'while IFS= read -r line; do',
      '  case "$line" in',
      `    *'"initialize"'*) printf '%s\\n' '{"id":1,"result":{"userAgent":"fake"}}' ;;`,
      `    *'account/rateLimits/read'*) printf '%s\\n' '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":45,"windowDurationMins":10080,"resetsAt":1796022268},"secondary":null,"planType":"plus"}}}' ;;`,
      '  esac',
      'done',
    ].join('\n'),
  );
  const s = await codexLimits(codex, {})();
  assert.equal(s?.plan, 'Plus');
  assert.deepEqual(s?.windows.map((w) => [w.label, w.pct]), [['Week', 45]]);
  // A CLI that can't answer is a failed read, not numbers.
  const broken = fakeBin(dir, 'codex-broken', 'exit 1');
  assert.equal(await codexLimits(broken, {})(), null);
});

test('Kimi quota becomes the 5-hour, week and month windows', () => {
  const s = parseKimiLimits(
    {
      usages: {
        limit_5h: { used_ratio: 0.2498, reset_time: '2026-11-25T05:31:43Z' },
        limit_7d: { used_ratio: 0.5 },
        limit_month_total: { used_ratio: 0.1873, reset_time: '2026-12-23T00:00:00Z' },
      },
    },
    'Ultra',
  );
  assert.equal(s.plan, 'Ultra');
  assert.deepEqual(
    s.windows.map((w) => [w.label, Math.round(w.pct), w.resetsAt]),
    [
      ['5h session', 25, Date.parse('2026-11-25T05:31:43Z')],
      ['Week', 50, undefined],
      ['Month', 19, Date.parse('2026-12-23T00:00:00Z')],
    ],
  );
  assert.deepEqual(parseKimiLimits({ usages: {} }).windows, []);
  assert.deepEqual(parseKimiLimits({ usages: { limit_5h: { used_ratio: 1.7 } } }).windows.map((w) => w.pct), [100]);
  assert.deepEqual(parseKimiLimits(null).windows, []);
});

/** Stubs global fetch for one test. */
function stubFetch(t: { after(fn: () => void): void }, handler: (url: string) => Response) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => handler(String(url))) as typeof fetch;
  t.after(() => (globalThis.fetch = real));
}

function kimiHome(dir: string, expiresAt = Math.floor(Date.now() / 1000) + 3600): string {
  const home = path.join(dir, 'kimi');
  mkdirSync(path.join(home, 'credentials'), { recursive: true });
  writeFileSync(path.join(home, 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_at: expiresAt }));
  return home;
}

test('the Kimi reader uses the CLI’s stored token against its region’s endpoint', async (t) => {
  const dir = tempDir(t);
  const home = kimiHome(dir);
  writeFileSync(path.join(home, 'region'), 'global');
  const urls: string[] = [];
  stubFetch(t, (url) => {
    urls.push(url);
    if (url.endsWith('/usages')) return new Response(JSON.stringify({ usages: { limit_5h: { used_ratio: 0.25 } } }), { status: 200 });
    if (url.endsWith('/me')) return new Response(JSON.stringify({ user_level_name: 'Ultra' }), { status: 200 });
    return new Response('nope', { status: 404 });
  });
  const s = await kimiLimits({ KIMI_CODE_HOME: home })();
  assert.equal(s?.plan, 'Ultra');
  assert.deepEqual(s?.windows.map((w) => [w.label, Math.round(w.pct)]), [['5h session', 25]]);
  assert.deepEqual(urls, ['https://api.kimi.ai/coding/v1/usages', 'https://api.kimi.ai/coding/v1/me']);
});

test('the Kimi reader shows no plan without a sign-in or an endpoint, and fails on an expired token or an error', async (t) => {
  const dir = tempDir(t);
  let handler: () => Response = () => {
    throw new Error('must not be called');
  };
  stubFetch(t, () => handler());

  // No credentials at all: nothing to show, and nothing asked.
  assert.deepEqual((await kimiLimits({ KIMI_CODE_HOME: path.join(dir, 'nowhere') })())?.windows, []);

  // An expired stored token is a failed read: only the CLI itself may refresh it.
  const expired = kimiHome(dir, Math.floor(Date.now() / 1000) - 60);
  assert.equal(await kimiLimits({ KIMI_CODE_HOME: expired })(), null);

  const home = kimiHome(dir);
  const env = { KIMI_CODE_HOME: home, KIMI_CODE_BASE_URL: 'https://stub.local/coding/v1' };
  // An endpoint that isn't there (an API key with no plan): nothing to show.
  handler = () => new Response('gone', { status: 404 });
  assert.deepEqual((await kimiLimits(env)())?.windows, []);
  // A rejected token: a failed read, never made-up numbers.
  handler = () => new Response('denied', { status: 401 });
  assert.equal(await kimiLimits(env)(), null);
});

test('the Claude reader still reads the stream-json get_usage answer, model weeks included', async (t) => {
  const dir = tempDir(t);
  const claude = fakeBin(
    dir,
    'claude',
    [
      'read -r line',
      `printf '%s\\n' '{"type":"control_response","response":{"request_id":"usage","subtype":"success","response":{"subscription_type":"max","rate_limits":{"five_hour":{"utilization":42,"resets_at":"2026-11-25T05:00:00Z"},"seven_day":{"utilization":61},"model_scoped":[{"display_name":"Fable","utilization":12}]}}}}'`,
    ].join('\n'),
  );
  const s = await claudeLimits(claude, {})();
  assert.equal(s?.plan, 'max');
  assert.deepEqual(
    s?.windows.map((w) => [w.label, w.pct]),
    [
      ['5h session', 42],
      ['Week', 61],
      ['Fable week', 12],
    ],
  );
  // An account with no plan (an API key) has nothing to show.
  const noPlan = fakeBin(dir, 'claude-noplan', 'read -r line\nprintf \'%s\\n\' \'{"type":"control_response","response":{"request_id":"usage","subtype":"success","response":{"rate_limits_available":false}}}\'');
  assert.deepEqual((await claudeLimits(noPlan, {})())?.windows, []);
  // One that can't answer is a failed read.
  assert.equal(await claudeLimits(path.join(dir, 'missing'), {})(), null);
});

test('the hub offers only providers that can genuinely report numbers', (t) => {
  const dir = tempDir(t);
  const codexHome = path.join(dir, 'codex');
  const kimiHomeDir = path.join(dir, 'kimi');
  const env = { CODEX_HOME: codexHome, KIMI_CODE_HOME: kimiHomeDir };
  const sources = { claude: '/bin/true', codex: '/bin/true', envFor: () => env, wanted: () => false, onChange: () => {} };

  // Signed in to nothing: Claude only (its CLI answers for itself), never a made-up Codex or Kimi.
  const bare = new LimitsHub(sources);
  assert.deepEqual(Object.keys(bare.state), ['claude']);
  bare.close();

  // A Codex login and a Kimi credential appear: both join the toggle.
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(path.join(codexHome, 'auth.json'), '{}');
  mkdirSync(path.join(kimiHomeDir, 'credentials'), { recursive: true });
  writeFileSync(path.join(kimiHomeDir, 'credentials', 'kimi-code.json'), '{}');
  const signed = new LimitsHub(sources);
  assert.deepEqual(Object.keys(signed.state), ['claude', 'codex', 'kimi']);
  signed.refresh('kimi'); // a provider refresh asks only its own reader
  signed.refresh();
  signed.close();

  // Without the codex binary there is no Codex tab, however signed in it is.
  const noBin = new LimitsHub({ ...sources, codex: null });
  assert.deepEqual(Object.keys(noBin.state), ['claude', 'kimi']);
  noBin.close();

  // A pasted Kimi API key is a sign-in of its own.
  const keyOnly = new LimitsHub({ ...sources, envFor: () => ({ CODEX_HOME: path.join(dir, 'none'), KIMI_CODE_HOME: path.join(dir, 'none'), KIMI_API_KEY: 'sk-test' }) });
  assert.deepEqual(Object.keys(keyOnly.state), ['claude', 'kimi']);
  keyOnly.close();
});
