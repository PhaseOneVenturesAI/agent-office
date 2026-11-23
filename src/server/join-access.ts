import { execFile } from 'node:child_process';
import WebSocket from 'ws';

export const ACCESS_HELP = 'Cloudflare Access authorization is missing or expired. Run cloudflared access login --quiet https://YOUR-OFFICE, then restart join --cloudflare-access. No token is printed by join.';
export type TokenRunner = (args: string[]) => Promise<string>;
const cachedToken: TokenRunner = (args) => new Promise((resolve, reject) => {
  execFile('cloudflared', args, { timeout: 10_000, maxBuffer: 32_000, encoding: 'utf8' }, (err, stdout) => err ? reject(new Error(ACCESS_HELP)) : resolve(stdout));
});

export function officeOrigin(input: string): string {
  const u = new URL(input);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw new Error('Use an http(s) office origin without credentials, path, query or fragment');
  return u.origin;
}

/** Credentials belong only on the intended handshake, never in URLs or redirected requests. */
export function nodeSocket(wsUrl: string, nodeToken: string, access: Record<string, string> = {}): WebSocket {
  return new WebSocket(`${wsUrl}/ws/node`, { handshakeTimeout: 10_000, followRedirects: false, headers: { Authorization: `Bearer ${nodeToken}`, ...access } });
}

/** A user-scoped cached token, never a service credential. No login or silent refresh here. */
export async function accessHeaders(origin: string, run: TokenRunner = cachedToken, now = Date.now()): Promise<{ headers: Record<string, string>; expiresAt: number }> {
  if (!origin.startsWith('https://') || officeOrigin(origin) !== origin) throw new Error('Cloudflare Access requires an HTTPS office origin');
  try {
    const token = (await run(['access', 'token', '--app', origin])).trim();
    if (token.length > 16_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    // Used only to stop on expiry; Cloudflare validates authenticity/audience at the edge.
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const expiresAt = Number(body.exp) * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now + 30_000) throw new Error();
    return { headers: { 'CF-Access-Token': token }, expiresAt };
  } catch { throw new Error(ACCESS_HELP); }
}
