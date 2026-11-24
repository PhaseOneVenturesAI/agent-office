import { createServer, type IncomingMessage } from 'node:http';
import { chmodSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { qualifyJob, type ApprovedQaJob } from './policy.js';
import { REQUEST_LIMIT, RESPONSE_LIMIT, validateRequest, validateResponse } from './protocol.js';

export type Transport = (body: Buffer, headers: Record<string, string>, signal: AbortSignal) => Promise<{ status: number; body: Buffer }>;
export const anthropicTransport: Transport = async (body, headers, signal) => {
  const response = await fetch('https://api.anthropic.com/v1/messages?beta=true', { method: 'POST', headers, body: new Uint8Array(body), signal, redirect: 'error' });
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > RESPONSE_LIMIT) { await response.body?.cancel().catch(() => {}); throw new Error('Response limit exceeded.'); }
    chunks.push(Buffer.from(chunk));
  }
  return { status: response.status, body: Buffer.concat(chunks) };
};
const header = (req: IncomingMessage, key: string) => typeof req.headers[key] === 'string' ? req.headers[key] as string : '';

/** Trusted controller supplies policy and one selected access token. Never exposed through HTTP. */
export async function createClaudeQaBroker(opts: { socket: string; job: ApprovedQaJob; accessToken: string; transport?: Transport; timeoutMs?: number }) {
  const job = structuredClone(opts.job), policy = qualifyJob(job);
  if (!opts.accessToken || /[\r\n]/.test(opts.accessToken)) throw new Error('Selected custodian access token unavailable.');
  const capability = randomBytes(32).toString('hex');
  const signal = new AbortController();
  let forwarded = false, accepted = 0, denied = 0, accessToken = opts.accessToken;
  const timer = setTimeout(() => signal.abort(), opts.timeoutMs ?? 120_000);
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const deny = (status = 403) => { denied++; res.writeHead(status, { 'content-type': 'application/json', 'x-should-retry': 'false' }); res.end('{"error":{"type":"permission_error","message":"Isolated Q&A request refused."}}'); };
    const auth = Buffer.from(header(req, 'authorization')), expected = Buffer.from(`Bearer ${capability}`);
    if (signal.signal.aborted || req.method !== 'POST' || !['/v1/messages', '/v1/messages?beta=true'].includes(req.url ?? '') || auth.length !== expected.length || !timingSafeEqual(auth, expected) || forwarded) return deny();
    if (header(req, 'content-type').split(';')[0] !== 'application/json' || req.headers['content-encoding'] || req.headers['transfer-encoding']) return deny();
    const beta = header(req, 'anthropic-beta');
    if (!/^[a-z0-9, -]{1,2048}$/i.test(beta) || !beta.includes('oauth-') || header(req, 'anthropic-version') !== '2023-06-01') return deny();
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > REQUEST_LIMIT) return deny(413); chunks.push(Buffer.from(chunk)); }
      qualifyJob(job); const body = validateRequest(Buffer.concat(chunks), job);
      // Reserve before awaiting upstream: concurrent retries cannot double-spend the lease.
      if (forwarded || signal.signal.aborted) return deny();
      forwarded = true;
      const reply = await (opts.transport ?? anthropicTransport)(body, { authorization: `Bearer ${accessToken}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': beta, 'content-type': 'application/json' }, signal.signal);
      if (signal.signal.aborted || reply.status !== 200) return deny(502);
      const safeReply = validateResponse(reply.body); accepted++;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-should-retry': 'false' }); res.end(safeReply);
    } catch { if (!res.headersSent) deny(502); else res.destroy(); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5000;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.socket, resolve); }); }
  catch (error) { clearTimeout(timer); signal.abort(); throw error; }
  // The parent directory is root-only; the socket is bind-mounted into one job namespace.
  chmodSync(opts.socket, 0o666);
  return { capability, policy, metrics: () => ({ forwarded, accepted, denied }), close: async () => {
    clearTimeout(timer); signal.abort(); accessToken = ''; server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
