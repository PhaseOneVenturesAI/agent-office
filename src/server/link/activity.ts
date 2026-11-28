import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jsonFile, uuid } from '../cubbies/local/io.js';

export interface Activity {
  schema: 1; event: string; sessionId: string;
  appSession?: string | null; cwd?: string | null; project?: string | null; at?: string | number | null;
  tool?: string | null; agentType?: string | null; agentId?: string | null;
  summary?: string | null; presence?: string | null; reply?: string | null; turn?: string | null;
}
const events = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop']);
export function cleanActivity(raw: unknown): Activity | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>;
  if (r.schema !== 1 || typeof r.event !== 'string' || !events.has(r.event) || !uuid(r.sessionId)) return;
  const result: Activity = { schema: 1, event: r.event, sessionId: r.sessionId };
  const caps = { appSession: 256, cwd: 4096, project: 256, tool: 64, agentType: 64, agentId: 80, summary: 256, presence: 256, reply: 4000, turn: 64 };
  for (const [key, cap] of Object.entries(caps)) {
    const value = r[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') return;
    Object.assign(result, { [key]: typeof value === 'string' ? value.slice(0, cap) : null });
  }
  if (r.at !== undefined) {
    if (r.at !== null && typeof r.at !== 'string' && !(typeof r.at === 'number' && Number.isFinite(r.at))) return;
    result.at = typeof r.at === 'string' ? r.at.slice(0, 64) : r.at as number | null;
  }
  return result;
}
export const harnessState = (home: string) => path.join(home, 'Library/Application Support/AgentHarness');

/** Only the local harness sees the capability file. Activity stays in this process. */
export async function startActivity(stateDirectory: string) {
  const activity = new EventEmitter<{ activity: [Activity] }>();
  const token = randomBytes(32).toString('hex'), expected = Buffer.from(`Bearer ${token}`);
  let port = 0;
  const server = createServer((req, res) => {
    const end = (code: number) => { res.writeHead(code); res.end(); req.resume(); };
    if (req.headers.host !== `127.0.0.1:${port}`) return end(403);
    if (req.method !== 'POST' || req.url !== '/v1/activity') return end(404);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return end(401);
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return end(404);
    if (Number(req.headers['content-length']) > 16 * 1024) return end(413);
    let bytes = 0, oversized = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > 16 * 1024) { oversized = true; chunks.length = 0; end(413); }
      else chunks.push(chunk);
    });
    req.on('error', () => { if (!res.writableEnded) end(404); });
    req.on('end', () => {
      if (oversized) return;
      let event: Activity | undefined;
      try { event = cleanActivity(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* invalid JSON */ }
      if (!event) return end(404);
      end(204);
      // Never hold the hook's response open for a subscriber's work.
      queueMicrotask(() => activity.emit('activity', event!));
    });
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = (server.address() as { port: number }).port;
  const file = path.join(stateDirectory, 'office-link.json'), temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify({ schema: 1, port, token, pid: process.pid }), { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600); renameSync(temporary, file);
  } catch (e) { server.close(); try { unlinkSync(temporary); } catch {} throw e; }
  let closed = false;
  return { activity, port, async close() {
    if (closed) return; closed = true;
    try { const record = jsonFile(file, 4096); if (record.pid === process.pid && record.token === token) unlinkSync(file); } catch { /* another link owns it now */ }
    activity.removeAllListeners();
    const done = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections(); await done;
  } };
}
