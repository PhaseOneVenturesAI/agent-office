import { randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

export const CLAUDE_QA_SOCKET = '/run/agent-office-claude-qa/controller.sock';
type Result = { ok: true; answer: string } | { ok: false; why: string };
const failed = (): Result => ({ ok: false, why: 'Isolated Claude Q&A is unavailable. Ask a manager controller for help.' });

/** Call only after the app's department, audience and exact-custodian consent checks pass. */
export function requestIsolatedClaudeQa(input: { custodianAccountId: string; prompt: string; signal?: AbortSignal }, connect: () => Socket = () => createConnection(CLAUDE_QA_SOCKET)): Promise<Result> {
  if (!/^[a-f0-9]{16}$/.test(input.custodianAccountId) || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 64_000 || input.signal?.aborted) return Promise.resolve(failed());
  const requestId = randomBytes(16).toString('hex');
  const raw = Buffer.from(JSON.stringify({ v: 1, requestId, custodianAccountId: input.custodianAccountId, prompt: input.prompt }));
  if (raw.length > 128_000) return Promise.resolve(failed());
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(raw.length);
  return new Promise(resolve => {
    let socket: Socket; try { socket = connect(); } catch { resolve(failed()); return; }
    let bytes = Buffer.alloc(0), expected: number | undefined, settled = false;
    const finish = (result: Result) => { if (settled) return; settled = true; clearTimeout(timer); input.signal?.removeEventListener('abort', cancel); socket.destroy(); resolve(result); };
    const cancel = () => finish(failed()), timer = setTimeout(cancel, 145_000);
    input.signal?.addEventListener('abort', cancel, { once: true });
    socket.once('connect', () => socket.write(Buffer.concat([prefix, raw]))); // Keep write side open: disconnect cancels the root job.
    socket.on('data', chunk => {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (bytes.length + data.length > 1_000_004) return finish(failed());
      bytes = Buffer.concat([bytes, data]);
      if (expected === undefined && bytes.length >= 4) { expected = bytes.readUInt32BE(); if (expected < 2 || expected > 1_000_000) return finish(failed()); }
      if (expected === undefined || bytes.length < expected + 4) return;
      if (bytes.length !== expected + 4) return finish(failed());
      try {
        const result = JSON.parse(bytes.subarray(4).toString());
        if (result.v !== 1 || result.requestId !== requestId || typeof result.ok !== 'boolean') return finish(failed());
        if (result.ok && Object.keys(result).sort().join() === 'answer,ok,requestId,v' && typeof result.answer === 'string' && result.answer.trim()) return finish({ ok: true, answer: result.answer });
        if (!result.ok && Object.keys(result).sort().join() === 'code,ok,requestId,v' && result.code === 'busy') return finish({ ok: false, why: 'The isolated Claude Q&A desk is busy. Try again shortly.' });
        finish(failed());
      } catch { finish(failed()); }
    });
    socket.once('error', cancel); socket.once('close', cancel);
    if (input.signal?.aborted) cancel();
  });
}
