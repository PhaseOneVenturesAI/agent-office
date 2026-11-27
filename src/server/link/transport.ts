import { setTimeout as delay } from 'node:timers/promises';
import type { MacConnector } from '../hq/local/connector.js';
import { accessHeaders, nodeSocket } from '../join-access.js';
export const ACCESS_RETRY_MS = 5 * 60_000;
export const backoff = (attempt: number) => Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000);
export const accessRefused = (status: number) => status === 401 || status === 403 || status >= 300 && status < 400;
export const signInNeeded = (origin: string) => `Cloudflare sign-in needed: run \`cloudflared access login ${origin}\``;
export class AccessRequired extends Error {}
/** A bounded response, no credential-bearing redirects and no server-supplied URLs. */
export async function request(origin: string, route: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(origin + route, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  if (accessRefused(response.status)) { await response.body?.cancel(); throw new AccessRequired(); }
  if (!response.ok) { await response.body?.cancel(); throw Error(`Link request failed (HTTP ${response.status})`); }
  const reader = response.body?.getReader(); if (!reader) throw Error('Empty link response');
  let text = '', size = 0; const decoder = new TextDecoder();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
    if (size > 4096) throw Error('Link response too large'); text += decoder.decode(value, { stream: true }); }
  } finally { await reader.cancel(); }
  return JSON.parse(text + decoder.decode());
}
export async function cachedAccess(origin: string): Promise<Record<string, string>> {
  if (!origin.startsWith('https:')) return {};
  try { return (await accessHeaders(origin)).headers; } catch { return {}; }
}
export type ConnectionResult = { access?: boolean; connected?: boolean; revoked?: boolean };
export function connection(origin: string, token: string, name: string, headers: Record<string, string>, connector: MacConnector, signal: AbortSignal): Promise<ConnectionResult> {
  return new Promise(resolve => {
    const ws = nodeSocket(origin.replace(/^http/, 'ws'), token, headers);
    let ended = false, connected = false, ping: NodeJS.Timeout | undefined;
    const finish = (result: ConnectionResult = {}) => {
      if (ended) return; ended = true; clearInterval(ping); signal.removeEventListener('abort', abort);
      connector.disconnected(); ws.terminate(); resolve({ connected, ...result });
    };
    const abort = () => finish(); signal.addEventListener('abort', abort, { once: true });
    ws.on('open', () => {
      if (ended) return; connected = true;
      ws.send(JSON.stringify({ t: 'hello', name, host: '', platform: process.platform, cpus: 0, memGB: 0, providers: [] }));
      connector.connected(frame => { if (ended || ws.readyState !== 1 || ws.bufferedAmount >= 128 * 1024) return false; ws.send(JSON.stringify(frame)); return true; }, name);
      ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping' })); }, 15_000);
    });
    ws.on('message', raw => { if (!ended) connector.receive(raw); });
    ws.on('unexpected-response', (_req, res) => { const access = accessRefused(res.statusCode ?? 0); res.destroy(); finish({ access }); });
    ws.on('error', () => finish());
    ws.on('close', code => finish({ revoked: code === 4000 || code === 4001 }));
    if (signal.aborted) abort();
  });
}
/** Dependency seam exercises the real retry policy without waiting five minutes in tests. */
export async function reconnect(origin: string, signal: AbortSignal, log: (s: string) => void,
  once: () => Promise<ConnectionResult>, wait = (ms: number) => delay(ms, undefined, { signal })) {
  let attempt = 0;
  while (!signal.aborted) {
    let result: ConnectionResult;
    try { result = await once(); } catch { result = {}; }
    if (signal.aborted) break;
    if (result.revoked) { log(`Mac link revoked; run \`agent-office link ${origin}\` again to approve this Mac`); return 78; }
    if (result.connected) attempt = 0;
    const ms = result.access ? ACCESS_RETRY_MS : backoff(attempt++);
    log(result.access ? signInNeeded(origin) : `Reconnecting in ${ms / 1000}s`);
    try { await wait(ms); } catch { if (!signal.aborted) throw Error('Reconnect wait failed'); }
  }
  return 0;
}
