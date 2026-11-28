import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { accessRefused } from './transport.js';

/**
 * A Cloudflare Access service token for this Mac's link (Client ID + Secret).
 * Read fresh for every request so a rotated token takes effect without a restart.
 * Values are only ever placed in request headers; never logged, printed or stored elsewhere.
 */
export class ServiceTokenError extends Error {}
export const serviceTokenFile = (home: string) => path.join(home, '.agent-office/link/cf-service-token.json');
const pattern = /^[A-Za-z0-9._-]{8,256}$/;
const credential = { test: (v: unknown) => typeof v === 'string' && pattern.test(v) };

export function readServiceToken(home: string): { clientId: string; clientSecret: string } | undefined {
  const file = serviceTokenFile(home);
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw new ServiceTokenError(code === 'ELOOP' ? `${file} must be a regular file, not a link` : `${file} is unreadable`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ServiceTokenError(`${file} must be a regular file`);
    if (process.getuid && stat.uid !== process.getuid()) throw new ServiceTokenError(`${file} must be owned by you`);
    if (stat.mode & 0o077) throw new ServiceTokenError(`${file} is readable by others; run \`chmod 600 ${file}\``);
    if (stat.size > 4096) throw new ServiceTokenError(`${file} is too large`);
    const bytes = Buffer.alloc(4097), size = readSync(fd, bytes, 0, bytes.length, 0);
    let record: any;
    try { record = JSON.parse(bytes.subarray(0, size).toString('utf8')); } catch { record = undefined; }
    if (!record || !credential.test(record.clientId) || !credential.test(record.clientSecret)) throw new ServiceTokenError(`${file} needs "clientId" and "clientSecret"`);
    return { clientId: record.clientId, clientSecret: record.clientSecret };
  } finally { closeSync(fd); }
}

/** Service-token headers, only ever for an HTTPS office. Throws ServiceTokenError on an unsafe file. */
export function serviceHeaders(home: string, origin: string): Record<string, string> | undefined {
  if (!origin.startsWith('https:')) return undefined;
  const token = readServiceToken(home);
  return token && { 'CF-Access-Client-Id': token.clientId, 'CF-Access-Client-Secret': token.clientSecret };
}

/** `link --check-access`: one bounded request; the answer is only "service token OK" or "refused (…)". */
export async function checkAccess(home: string, origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  let headers: Record<string, string> | undefined;
  try { headers = serviceHeaders(home, origin); }
  catch (e) { return `refused (${(e as Error).message})`; }
  if (!headers) return origin.startsWith('https:') ? 'refused (no service token file)' : 'refused (service tokens need an https office)';
  try {
    const response = await fetcher(origin + '/', { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    return accessRefused(response.status) ? `refused (${response.status})` : 'service token OK';
  } catch { return 'refused (network error)'; }
}
