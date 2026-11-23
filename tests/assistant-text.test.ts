import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssistantTurn, assistantRecord, readAssistantReply } from '../src/server/assistant-text.js';
import { safeAssistantText, spokenAssistantText } from '../src/shared/assistant-text.js';

const claude = (more: object = {}) => ({ type: 'assistant', sessionId: 'session-1', uuid: 'message-1', isSidechain: false, message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text: 'The focused checks passed.' }] }, ...more });
const codex = (more: object = {}) => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed', id: 'message-1', content: [{ type: 'output_text', text: 'Ready for review.' }], ...more } });

test('accepts installed Claude and Codex final text shapes; excludes thoughts, users, tools and subagents', () => {
  assert.equal(assistantRecord('claude', claude(), 'session-1')?.text, 'The focused checks passed.');
  assert.equal(assistantRecord('codex', codex(), 'session-1')?.text, 'Ready for review.');
  for (const row of [claude({ isSidechain: true }), claude({ sessionId: 'other' }), claude({ type: 'user' }), claude({ message: { role: 'assistant', content: [{ type: 'thinking', text: 'hidden' }] } }), claude({ message: { role: 'assistant', content: [{ type: 'tool_use', text: 'secret output' }] } })]) assert.equal(assistantRecord('claude', row, 'session-1'), undefined);
  for (const row of [codex({ phase: 'analysis' }), codex({ status: 'in_progress' }), codex({ role: 'user' }), codex({ content: [{ type: 'function_call_output', text: 'hidden' }] })]) assert.equal(assistantRecord('codex', row, 'session-1'), undefined);
});

test('never turn terminal escapes or recognizable credentials into speech; omit code and links', () => {
  for (const value of ['\x1b[31mterminal', 'api_key: sk-example-123456789012345', 'password=hidden', 'Bearer abc', 'x'.repeat(24001)]) assert.equal(safeAssistantText(value), undefined);
  assert.equal(spokenAssistantText('All done. ```sh\nrm -rf /tmp/example\n``` See https://example.test and `private-code`.'), 'All done.  See  and .');
});

test('ACP buffers assistant text only, discards oversized/malformed turns and resets between turns', () => {
  const turn = new AssistantTurn();
  turn.append({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hidden' } });
  turn.append({ sessionUpdate: 'tool_call_update', content: { type: 'text', text: 'tool output' } });
  turn.append({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
  turn.append({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there.' } });
  assert.equal(turn.finish(), 'Hello there.'); assert.equal(turn.finish(), undefined);
  turn.append({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x'.repeat(24001) } });
  assert.equal(turn.finish(), undefined);
  turn.append({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', text: 'not prose' } });
  assert.equal(turn.finish(), undefined);
});

test('bounded root-transcript reader rejects path escapes, mismatched sessions, symlinks, partial lines and unsafe last answers', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'office-assistant-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'projects', 'project'); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session-1.jsonl');
  const write = (rows: unknown[]) => writeFileSync(file, rows.map((v) => JSON.stringify(v)).join('\n') + '\n');
  write([claude()]); assert.ok(readAssistantReply('claude', file, 'session-1', home));
  assert.equal(readAssistantReply('claude', file, 'other', home), undefined);
  assert.equal(readAssistantReply('claude', file, 'session-1', dir), undefined);
  write([claude(), claude({ uuid: 'unsafe', message: { role: 'assistant', content: [{ type: 'text', text: 'password=hidden' }] } })]);
  assert.equal(readAssistantReply('claude', file, 'session-1', home), undefined);
  write([claude(), { type: 'user', message: { role: 'user', content: 'new turn' } }]);
  assert.equal(readAssistantReply('claude', file, 'session-1', home), undefined);
  writeFileSync(file, JSON.stringify(claude())); assert.equal(readAssistantReply('claude', file, 'session-1', home), undefined);
  const other = path.join(home, 'outside.jsonl'); writeFileSync(other, JSON.stringify(claude()) + '\n'); rmSync(file); symlinkSync(other, file);
  assert.equal(readAssistantReply('claude', file, 'session-1', home), undefined);
});

test('Codex requires root rollout session header and final-answer records', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'office-codex-answer-')); t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'sessions', '2026'); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-session-1.jsonl');
  const write = (id: string) => writeFileSync(file, [JSON.stringify({ type: 'session_meta', payload: { id } }), JSON.stringify(codex()), ''].join('\n'));
  write('session-1'); assert.equal(readAssistantReply('codex', file, 'session-1', home)?.text, 'Ready for review.');
  write('other'); assert.equal(readAssistantReply('codex', file, 'session-1', home), undefined);
});
