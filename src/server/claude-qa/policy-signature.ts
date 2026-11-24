import { X509Certificate, verify } from 'node:crypto';
import { policyHash, record, type PolicyEvidence } from './policy.js';

// Public trust anchor embedded in qualified Claude 2.1.331. Changing it requires qualification.
export const CLAUDE_POLICY_ROOT = `-----BEGIN CERTIFICATE-----
MIIB3TCCAYKgAwIBAgIUANUYY/tuc08yPd9Nsh7rY/zDEiwwCgYIKoZIzj0EAwIw
OjESMBAGA1UEChMJQW50aHJvcGljMSQwIgYDVQQDExtBbnRocm9waWMgQXBwcyBT
aWduaW5nIFJvb3QwHhcNMjYwOTAyMjMzNDMwWhcNNDEwODI5MjMzNDI5WjA6MRIw
EAYDVQQKEwlBbnRocm9waWMxJDAiBgNVBAMTG0FudGhyb3BpYyBBcHBzIFNpZ25p
bmcgUm9vdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABAsUtD9z65VTC61W8M40
B+bGEhcvb+8mLm/9aTh39H4lwLH0agHzBBqkt4dvqqGzo1J2pJN7L7UoX9nEEVbO
7rmjZjBkMA4GA1UdDwEB/wQEAwIBBjASBgNVHRMBAf8ECDAGAQH/AgEBMB0GA1Ud
DgQWBBQW+2L0kdDEOi+A6fBK5jpwNdtoCzAfBgNVHSMEGDAWgBQW+2L0kdDEOi+A
6fBK5jpwNdtoCzAKBggqhkjOPQQDAgNJADBGAiEA+vhhLCvaUT2ccO0ND0YZaUy0
e+zhUoJOBhE9hXPs+SkCIQCHdbMcFo/ZQEq/rVnaS8qv/BZvRfYoEm318TY0WBU4
XA==
-----END CERTIFICATE-----`;

export function verifyPolicySignature(input: {
  jws: string; kind: 'managed-settings' | 'policy-limits'; body: unknown;
  identity: PolicyEvidence['nativeIdentity']; now?: number;
}, trust = { pem: CLAUDE_POLICY_ROOT, marker: 'urn:anthropic:claude-code:signed-cache:production', issuer: 'Claude Code Signed Cache Issuing CA' }): void {
  try {
    const { jws, kind, body, identity } = input, now = input.now ?? Date.now();
    if (jws.length > 16384) throw new Error();
    const parts = jws.split('.');
    if (parts.length !== 3 || parts.some(v => !/^[A-Za-z0-9_-]+$/.test(v))) throw new Error();
    const [h, p, signature] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()), claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!record(header) || header.alg !== 'ES256' || header.typ !== 'cc-signed-cache+jws' || typeof header.kid !== 'string' || !Array.isArray(header.x5c) || header.x5c.length !== 2) throw new Error();
    const certificates = header.x5c.map(v => {
      if (typeof v !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) throw new Error();
      const der = Buffer.from(v, 'base64'), cert = new X509Certificate(der);
      if (der.length > 8192 || cert.raw.length !== der.length) throw new Error();
      return cert;
    });
    const [leaf, issuer] = certificates, root = new X509Certificate(trust.pem);
    // Exactly one issuing CA below the pinned root: no additional subordinate CA/path.
    if (leaf.ca || !issuer.ca || !root.ca || !leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey) || !issuer.checkIssued(root) || !issuer.verify(root.publicKey)) throw new Error();
    if (issuer.toLegacyObject().subject.CN !== trust.issuer || !leaf.subjectAltName?.split(/,\s*/).includes(`URI:${trust.marker}`)) throw new Error();
    if (leaf.publicKey.asymmetricKeyType !== 'ec' || leaf.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !verify('sha256', Buffer.from(`${h}.${p}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) throw new Error();
    if (!record(claims) || claims.v !== 1 || claims.typ !== kind || claims.aud !== identity.organizationUuid || claims.sub !== identity.accountUuid || (identity.workspaceUuid !== undefined && claims.ws !== identity.workspaceUuid) || claims.sha !== `sha256:${policyHash(body)}` || claims.abs !== undefined) throw new Error();
    const iat = claims.iat, exp = claims.exp;
    if (typeof iat !== 'number' || !Number.isFinite(iat) || (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp)))) throw new Error();
    const end = Math.min(iat + 86400, exp as number ?? Infinity);
    if (now / 1000 < iat - 300 || now / 1000 > end || end <= iat) throw new Error();
    for (const cert of [leaf, issuer, root]) if (iat * 1000 < Date.parse(cert.validFrom) - 300_000 || iat * 1000 > Date.parse(cert.validTo)) throw new Error();
  } catch { throw new Error('Claude policy signature, identity, or lifetime is not qualified.'); }
}
