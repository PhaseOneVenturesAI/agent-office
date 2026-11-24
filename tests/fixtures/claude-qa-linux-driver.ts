// Root-only scratch harness. Transport is always an in-process dummy; no provider request is possible.
import { runClaudeQaIsolated } from '../../src/server/claude-qa/runtime.js';
import { makeJob, responseBody } from './claude-qa-data.js';
const image = process.argv[2];
const mode = process.argv[3] ?? 'baseline';
let captured: unknown;
const result = await runClaudeQaIsolated({ image, job: makeJob(), accessToken: 'DUMMY_UPSTREAM_ONLY_NEVER_IN_RUNNER', runtimeSeconds: mode === 'timeout' ? 3 : 20, transport: async (body, headers, signal) => {
  const parsed = JSON.parse(body.toString());
  captured = { model: parsed.model, tools: parsed.tools, maxTokens: parsed.max_tokens, oauthBeta: headers['anthropic-beta'].includes('oauth-'), selectedDummyToken: headers.authorization === 'Bearer DUMMY_UPSTREAM_ONLY_NEVER_IN_RUNNER' };
  if (mode === 'timeout') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('dummy timeout')), { once: true }));
  return { status: 200, body: mode === 'oversize' ? Buffer.alloc(1_000_001) : responseBody(mode === 'forged') };
} });
console.log(JSON.stringify({ mode, result, captured }));
if (mode === 'baseline' ? !result.ok : result.ok) process.exitCode = 1;
