import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';
import { verifyPolicySignature } from '../src/server/claude-qa/policy-signature.js';
import { nativePolicyReady } from '../src/server/claude-qa/native-policy-ready.js';
import { qualifySelectedAccount } from '../src/server/claude-qa/native-policy-adapter.js';
import { policyHash, qualifyJob } from '../src/server/claude-qa/policy.js';
import { makeJob } from './fixtures/claude-qa-data.js';

test('signature verifier binds document, account, organization, expiry, CA and policy kind', async () => {
  const options = { keyType: 'ec' as const, curve: 'P-256' as const, algorithm: 'sha256' };
  const root = await generate([{ name: 'commonName', value: 'TEST ROOT ONLY' }], { ...options, extensions: [{ name: 'basicConstraints', cA: true, pathLenConstraint: 1 }] });
  const issuer = await generate([{ name: 'commonName', value: 'TEST ISSUER' }], { ...options, ca: { cert: root.cert, key: root.private }, extensions: [{ name: 'basicConstraints', cA: true, pathLenConstraint: 0 }] });
  const leaf = await generate([{ name: 'commonName', value: 'TEST LEAF' }], { ...options, ca: { cert: issuer.cert, key: issuer.private }, extensions: [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: [{ type: 6, value: 'urn:test:policy' }] }] });
  const policy = makeJob().policy, now = Date.now();
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const header = encode({ alg: 'ES256', typ: 'cc-signed-cache+jws', kid: 'test', x5c: [leaf.cert, issuer.cert].map(p => new X509Certificate(p).raw.toString('base64')) });
  const payload = encode({ v: 1, typ: 'policy-limits', aud: policy.nativeIdentity.organizationUuid, sub: policy.nativeIdentity.accountUuid, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600, sha: `sha256:${policyHash(policy.limits)}` });
  const jws = `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), { key: leaf.private, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const input = { jws, kind: 'policy-limits' as const, body: policy.limits, identity: policy.nativeIdentity, now };
  const trust = { pem: root.cert, marker: 'urn:test:policy', issuer: 'TEST ISSUER' };
  verifyPolicySignature(input, trust);
  assert.throws(() => verifyPolicySignature(input)); // A fixture root is never production trust.
  for (const bad of [
    { ...input, body: {} }, { ...input, now: now + 601000 }, { ...input, now: now - 301000 },
    { ...input, identity: { ...input.identity, accountUuid: 'other' } },
    { ...input, identity: { ...input.identity, organizationUuid: 'other' } },
    { ...input, identity: { ...input.identity, workspaceUuid: 'not-signed' } },
    { ...input, kind: 'managed-settings' as const }, { ...input, jws: input.jws.slice(0, -3) + 'AAA' },
  ]) assert.throws(() => verifyPolicySignature(bad, trust));
});
test('native readiness requires both applied messages and exact saved documents; links fail closed', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'native-policy-')), policy = makeJob().policy;
  try {
    writeFileSync(path.join(home, 'remote-settings.json'), JSON.stringify(policy.settings));
    writeFileSync(path.join(home, 'policy-limits.json'), JSON.stringify(policy.limits));
    assert.equal(nativePolicyReady(home, policy), false);
    writeFileSync(path.join(home, 'native-policy.log'), '[DEBUG] Policy limits: Applied new restrictions successfully\n[DEBUG] Remote settings: Applied new settings successfully\n');
    assert.equal(nativePolicyReady(home, policy), true);
    writeFileSync(path.join(home, 'policy-limits.json'), '{}'); assert.equal(nativePolicyReady(home, policy), false);
    rmSync(path.join(home, 'policy-limits.json')); symlinkSync('/etc/passwd', path.join(home, 'policy-limits.json')); assert.equal(nativePolicyReady(home, policy), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('unsupported policy and identity never become an empty or permissive snapshot', async () => {
  const job = makeJob(); qualifyJob(job); assert.equal((job.policy.limits.restrictions as any).require_trusted_devices.allowed, true);
  for (const mutate of [
    (j: any) => { j.policy.limits.restrictions.unknown = { allowed: false }; },
    (j: any) => { j.policy.limits.defaults.remote_control_at_startup = true; },
    (j: any) => { j.policy.limits.compliance_taints = ['hipaa']; },
    (j: any) => { j.policy.limits.monitoring_notice = { text: 'required' }; },
    (j: any) => { j.policy.nativeIdentity.subscriptionType = 'max'; },
    (j: any) => { j.policy.nativeIdentity.expiresAt = Date.now(); },
  ]) { const copy = makeJob(); mutate(copy); assert.throws(() => qualifyJob(copy)); }
  let requests = 0;
  const context = { accountId: job.accountId, accessToken: 'dummy', oauthAccount: job.policy.nativeIdentity, signal: new AbortController().signal };
  await assert.rejects(qualifySelectedAccount(context, async () => { requests++; return { status: 503, body: Buffer.from('{}'), headers: {} }; }));
  assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(qualifySelectedAccount({ ...context, oauthAccount: {} }, async () => { requests++; throw new Error(); }));
  assert.equal(requests, 0);
});
