// Cloudflare Access single sign-on: the office trusts the JWT Cloudflare's edge mints after its
// own login (email OTP, SSO, whatever the team uses), verifies it against the team's published
// keys, and signs the email it names into the office with an account of their own — no office
// password at all. The origin only ever sees traffic that came through Cloudflare (a tunnel), and
// a forged header fails the signature check, so the edge stays the one front door.
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { parseCookies } from './auth.js';

/** How long the team's signing keys are kept before they're fetched again. */
const CERTS_TTL_MS = 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const MAX_JWT = 16_000;

interface Certs {
  keys: (JsonWebKey & { kid?: string })[];
  at: number;
}

/** The JSON body's text, or nothing. Answers are small; anything bigger isn't Cloudflare's. */
async function defaultFetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export class CloudflareAccess {
  private certs?: Certs;

  constructor(
    /** The team subdomain: <team>.cloudflareaccess.com. */
    private team: string,
    /** The application's audience tag, from its Access config. */
    private aud: string,
    /** Emails whose accounts are admins (cased any way). */
    admins: Set<string>,
    /** Overridable for tests. */
    private fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
  ) {
    this.admins = new Set([...admins].map((e) => e.toLowerCase()));
  }

  private admins: Set<string>;

  isAdmin(email: string): boolean {
    return this.admins.has(email.toLowerCase());
  }

  /** The email Cloudflare vouches for on this request, or nothing when it can't be trusted. */
  async emailOf(req: IncomingMessage): Promise<string | undefined> {
    const header = req.headers['cf-access-jwt-assertion'];
    const jwt = (typeof header === 'string' ? header : undefined) ?? parseCookies(req.headers.cookie).CF_Authorization;
    if (!jwt || jwt.length > MAX_JWT) return undefined;
    const [head, body, sig] = jwt.split('.');
    if (!head || !body || !sig) return undefined;
    try {
      const h = JSON.parse(decode(head)) as { alg?: string; kid?: string };
      if (h.alg !== 'RS256' || !h.kid) return undefined;
      const keys = await this.keys();
      const jwk = keys.find((k) => k.kid === h.kid);
      if (!jwk) return undefined;
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if (!verifySignature('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'))) return undefined;
      // Only claims in a signed body mean anything: checked after the signature, never before.
      const p = JSON.parse(decode(body)) as { iss?: string; aud?: string | string[]; exp?: number; email?: unknown };
      if (p.iss !== `https://${this.team}.cloudflareaccess.com`) return undefined;
      const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
      if (!aud.includes(this.aud)) return undefined;
      if (typeof p.exp !== 'number' || p.exp * 1000 <= Date.now() - CLOCK_SKEW_MS) return undefined;
      const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
    } catch {
      return undefined;
    }
  }

  private async keys(): Promise<Certs['keys']> {
    if (this.certs && Date.now() - this.certs.at < CERTS_TTL_MS) return this.certs.keys;
    const json = (await this.fetchJson(`https://${this.team}.cloudflareaccess.com/cdn-cgi/access/certs`)) as { keys?: Certs['keys'] };
    const keys: Certs['keys'] = Array.isArray(json?.keys) ? json.keys.filter((k) => k && k.kty === 'RSA' && typeof k.kid === 'string') : [];
    if (!keys.length) throw new Error('no signing keys in the response');
    this.certs = { keys, at: Date.now() };
    return keys;
  }
}

const decode = (part: string) => Buffer.from(part, 'base64url').toString('utf8');
