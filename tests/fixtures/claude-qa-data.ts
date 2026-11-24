import type { ApprovedQaJob } from '../../src/server/claude-qa/policy.js';
export const makeJob = (): ApprovedQaJob => ({ accountId: 'dummy-custodian', model: 'claude-sonnet-4-6', prompt: 'Reply QA_STUB_OK using only the approved context.', policy: {
  accountId: 'dummy-custodian', fetchedAt: Date.now(), source: 'authenticated-native-policy', settings: { channelsEnabled: false },
  limits: { restrictions: { allow_connector_file_downloads: { allowed: false }, allow_connector_file_uploads: { allowed: false }, allow_computer_use: { allowed: false }, enforce_web_search_mcp_isolation: { allowed: false }, require_trusted_devices: { allowed: true } }, compliance_taints: [], monitoring_notice: null, defaults: { remote_control_at_startup: false } },
  nativeIdentity: { accountUuid: '11111111-1111-4111-8111-111111111111', organizationUuid: '22222222-2222-4222-8222-222222222222', subscriptionType: 'team', scopes: ['user:profile', 'user:inference'], expiresAt: Date.now() + 3600_000 },
  settingsEnvelope: { uuid: 'dummy-policy', checksum: 'dummy-checksum', settings: { channelsEnabled: false } },
  // Only the trusted dummy runtime fixtures use opaque signatures. The production adapter
  // verifies signatures against the pinned public root before it can create evidence.
  signatures: { settings: 'dummy-settings-signature', limits: 'dummy-limits-signature' },
} });
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
