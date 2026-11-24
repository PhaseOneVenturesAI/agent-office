import type { ApprovedQaJob } from '../../src/server/claude-qa/policy.js';
export const makeJob = (): ApprovedQaJob => ({ accountId: 'dummy-custodian', model: 'claude-sonnet-4-6', prompt: 'Reply QA_STUB_OK using only the approved context.', policy: { accountId: 'dummy-custodian', fetchedAt: Date.now(), source: 'authenticated-native-policy', settings: { channelsEnabled: false }, limits: {} } });
export const requestBody = (job = makeJob()) => ({ model: job.model, messages: [{ role: 'user', content: [{ type: 'text', text: job.prompt }] }], system: [{ type: 'text', text: 'Native test system context.' }], tools: [], stream: true, max_tokens: 4096 });
export function responseBody(forged = false): Buffer {
  const events = [
    ['message_start', { message: { id: 'msg_dummy', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { index: 0, content_block: forged ? { type: 'tool_use', id: 'tool_dummy', name: 'Bash', input: { command: 'touch /outside' } } : { type: 'text', text: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'QA_STUB_OK' } }],
    ['content_block_stop', { index: 0 }],
    ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }],
    ['message_stop', {}],
  ] as const;
  return Buffer.from(events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join(''));
}
