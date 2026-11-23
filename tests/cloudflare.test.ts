// Cloudflare Access sign-in: the JWT is verified against the team's keys before any claim is
// trusted, and verified emails get passwordless accounts (see server/cloudflare.ts, accounts.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signData } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CloudflareAccess } from '../src/server/cloudflare.js';
import { Accounts } from '../src/server/accounts.js';

const TEAM = 'phaseoneventures';
const AUD = '0e56329320c2d523b351c5978f9cdf4444aa165d16e458287d9c40235ee13969';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey as import('node:crypto').KeyObject).export({ format: 'jwk' }), kid: 'test-key-1' };

function jwt(claims: Record<string, unknown>, key = privateKey): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${head}.${body}.${signData('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

const good = (email = 'jonathan@phaseoneventures.com') =>
  jwt({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: AUD, exp: Math.floor(Date.now() / 1000) + 300, email });

function make(admins: string[] = []) {
  return new CloudflareAccess(TEAM, AUD, new Set(admins), async () => ({ keys: [jwk] }));
}

const reqWith = (headers: Record<string, string>) => ({ headers }) as IncomingMessage;

test('a signed, current JWT from the team names its email; anything else does not', async () => {
  const cf = make();
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': good() })), 'jonathan@phaseoneventures.com');
  // The CF_Authorization cookie carries it just as well.
  assert.equal(await cf.emailOf(reqWith({ cookie: `CF_Authorization=${good('IVANH@phaseoneventures.com')}` })), 'ivanh@phaseoneventures.com');
  assert.equal(await cf.emailOf(reqWith({})), undefined);
  // Not the team's issuer.
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': jwt({ iss: 'https://evil.cloudflareaccess.com', aud: AUD, exp: 9e9, email: 'a@b.co' }) })), undefined);
  // Another application's audience.
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': jwt({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: 'other', exp: 9e9, email: 'a@b.co' }) })), undefined);
  // Expired.
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': jwt({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: AUD, exp: 1, email: 'a@b.co' }) })), undefined);
  // Signed with a different key.
  const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': good('a@b.co').replace(/[^.]+$/, 'x') })), undefined);
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': jwt({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: AUD, exp: 9e9, email: 'a@b.co' }, other) })), undefined);
  // Claims are never trusted without a signature: a doctored body fails.
  const [h, , s] = good().split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ iss: `https://${TEAM}.cloudflareaccess.com`, aud: AUD, exp: 9e9, email: 'attacker@evil.com' })).toString('base64url')}.${s}`;
  assert.equal(await cf.emailOf(reqWith({ 'cf-access-jwt-assertion': forged })), undefined);
});

test('admins come from the configured list, case-insensitively', () => {
  const cf = make(['Jonathan@phaseoneventures.com']);
  assert.equal(cf.isAdmin('jonathan@phaseoneventures.com'), true);
  assert.equal(cf.isAdmin('ivanh@phaseoneventures.com'), false);
});

test('provision makes a passwordless account per email, deduplicating names', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cf-accounts-'));
  try {
    const accounts = new Accounts(dir);
    const a = accounts.provision('jonathan@phaseoneventures.com', 'admin');
    assert.equal(a.name, 'Jonathan');
    assert.equal(a.role, 'admin');
    assert.equal(a.hash, undefined);
    // The same email is the same account, never a second one.
    assert.equal(accounts.provision('jonathan@phaseoneventures.com', 'member').id, a.id);
    const b = accounts.provision('jonathan@jdiaz.com', 'member');
    assert.equal(b.name, 'Jonathan 2');
    // A password never signs a provisioned account in, and a fresh Accounts sees it too.
    assert.equal(await accounts.check('Jonathan', 'whatever-password'), undefined);
    const again = new Accounts(dir);
    assert.equal(again.byEmail('jonathan@phaseoneventures.com')?.id, a.id);
    assert.equal(again.state(new Set()).accounts.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the /api/cf-login route is registered, and public', async () => {
  // Unregistered, the sign-in check answers it with "Not logged in" and the login page falls back
  // to a password form — the bug where Cloudflare sign-in silently stopped being enough.
  const { routes } = await import('../src/server/http/routes/index.js');
  const route = routes.find((r) => r.path === '/api/cf-login');
  assert.ok(route, 'cf-login is in the route table');
  assert.equal(route!.method, 'POST');
  assert.equal(route!.auth, 'public');
});
