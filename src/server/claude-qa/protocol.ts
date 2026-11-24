import { CLAUDE_QA_MODEL, type ApprovedQaJob } from './policy.js';

export const REQUEST_LIMIT = 256_000;
export const RESPONSE_LIMIT = 1_000_000;
const keys = ['model', 'messages', 'system', 'tools', 'metadata', 'max_tokens', 'thinking', 'context_management', 'output_config', 'diagnostics', 'stream'];
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, any>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function blocks(v: unknown, system = false): v is { type: 'text'; text: string }[] {
  return Array.isArray(v) && v.length <= 64 && v.every(b => record(b) && exactKeys(b, ['type', 'text', 'cache_control']) && b.type === 'text' && typeof b.text === 'string' && (!b.cache_control || (record(b.cache_control) && exactKeys(b.cache_control, ['type', 'ttl', 'scope']) && (b.cache_control.scope === undefined || (system && b.cache_control.scope === 'global')) && b.cache_control.type === 'ephemeral' && (!b.cache_control.ttl || ['5m', '1h'].includes(b.cache_control.ttl)))));
}
/** Reject unsupported capabilities; preserve validated values in canonical JSON. */
export function validateRequest(raw: Buffer, job: ApprovedQaJob): Buffer {
  if (raw.length > REQUEST_LIMIT) throw new Error('Request too large.');
  const b: unknown = JSON.parse(raw.toString('utf8'));
  if (!record(b) || !exactKeys(b, keys) || b.model !== job.model || b.stream !== true || !Array.isArray(b.tools) || b.tools.length || !Number.isInteger(b.max_tokens) || b.max_tokens < 1 || b.max_tokens > 4096) throw new Error('Unsupported inference request.');
  if (!blocks(b.system, true) || !Array.isArray(b.messages) || b.messages.length !== 1) throw new Error('Unsupported context.');
  const m = b.messages[0];
  if (!record(m) || !exactKeys(m, ['role', 'content']) || m.role !== 'user' || !blocks(m.content) || m.content.at(-1)?.text !== job.prompt) throw new Error('Question is not the approved job.');
  // Earlier blocks are the pinned CLI's environment reminders, not a second conversation.
  if (m.content.slice(0, -1).some((x: any) => !x.text.startsWith('<system-reminder>') || !x.text.trimEnd().endsWith('</system-reminder>'))) throw new Error('Unqualified native reminder.');
  if (b.metadata && (!record(b.metadata) || !exactKeys(b.metadata, ['user_id']) || typeof b.metadata.user_id !== 'string' || b.metadata.user_id.length > 1024)) throw new Error('Unsupported metadata.');
  if (b.diagnostics !== undefined && (!record(b.diagnostics) || !exactKeys(b.diagnostics, ['previous_message_id']) || b.diagnostics.previous_message_id !== null)) throw new Error('A previous native conversation is not permitted.');
  if (b.thinking && JSON.stringify(b.thinking) !== JSON.stringify({ type: 'adaptive', display: 'omitted' })) throw new Error('Unsupported thinking configuration.');
  if (b.context_management && JSON.stringify(b.context_management) !== JSON.stringify({ edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] })) throw new Error('Unsupported context configuration.');
  if (b.output_config && (!record(b.output_config) || !exactKeys(b.output_config, ['effort']) || !['low', 'medium', 'high'].includes(b.output_config.effort))) throw new Error('Unsupported output configuration.');
  // Serialize the validated value, so duplicate JSON keys cannot be interpreted differently upstream.
  return Buffer.from(JSON.stringify(b));
}

/** Buffer a bounded response before exposing it: no tool block ever reaches the native process. */
export function validateResponse(raw: Buffer): Buffer {
  if (!raw.length || raw.length > RESPONSE_LIMIT) throw new Error('Invalid response size.');
  let started = false, stopped = false, ended = false, textBlocks = 0, activeBlock: number | undefined;
  const frames: string[] = [];
  for (const frame of raw.toString('utf8').replaceAll('\r\n', '\n').split('\n\n').filter(x => x.trim())) {
    const lines = frame.split('\n');
    if (lines.filter(x => x.startsWith('event:')).length !== 1 || lines.some(x => !x.startsWith('event:') && !x.startsWith('data:'))) throw new Error('Unsupported event framing.');
    const event = lines.find(x => x.startsWith('event:'))?.slice(6).trim();
    const data = JSON.parse(lines.filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n'));
    if (!record(data) || event !== data.type || stopped) throw new Error('Unsupported event.');
    const fields: Record<string,string[]> = { ping:['type'], message_start:['type','message'], content_block_start:['type','index','content_block'], content_block_delta:['type','index','delta'], content_block_stop:['type','index'], message_delta:['type','delta','usage'], message_stop:['type'] };
    if (!fields[event!] || !exactKeys(data, fields[event!])) throw new Error('Unsupported event fields.');
    switch (event) {
      case 'ping': break;
      case 'message_start':
        if (started || !record(data.message) || !exactKeys(data.message, ['id','type','role','model','content','usage','stop_reason','stop_sequence']) || data.message.type !== 'message' || data.message.role !== 'assistant' || data.message.model !== CLAUDE_QA_MODEL || !Array.isArray(data.message.content) || data.message.content.length || data.message.stop_reason != null) throw new Error('Unsupported message.');
        started = true; break;
      case 'content_block_start':
        if (!started || ended || activeBlock !== undefined || data.index !== textBlocks || !record(data.content_block) || !exactKeys(data.content_block, ['type', 'text']) || data.content_block.type !== 'text' || typeof data.content_block.text !== 'string') throw new Error('Tool or unsupported response block.');
        activeBlock = textBlocks++; break;
      case 'content_block_delta':
        if (activeBlock === undefined || data.index !== activeBlock || !record(data.delta) || !exactKeys(data.delta, ['type', 'text']) || data.delta.type !== 'text_delta' || typeof data.delta.text !== 'string') throw new Error('Unsupported response delta.');
        break;
      case 'content_block_stop':
        if (activeBlock === undefined || data.index !== activeBlock) throw new Error('Unexpected block stop.');
        activeBlock = undefined; break;
      case 'message_delta':
        if (!started || !textBlocks || ended || activeBlock !== undefined || !record(data.delta) || !exactKeys(data.delta, ['stop_reason', 'stop_sequence']) || !['end_turn', 'max_tokens', 'stop_sequence'].includes(data.delta.stop_reason)) throw new Error('Unsupported stop reason.');
        ended = true; break;
      case 'message_stop': if (!ended || activeBlock !== undefined) throw new Error('Incomplete response.'); stopped = true; break;
      default: throw new Error('Unsupported response event.');
    }
    frames.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  if (!stopped) throw new Error('Incomplete response.');
  return Buffer.from(frames.join(''));
}
