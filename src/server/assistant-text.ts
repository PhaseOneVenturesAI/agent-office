import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { safeAssistantText } from '../shared/assistant-text.js';

export interface AssistantReply { id: string; text: string }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Final structured text only. Tool results, thoughts, users and subagents never enter this feed. */
export function assistantRecord(provider: 'claude' | 'codex', row: unknown, sessionId: string): AssistantReply | undefined {
  if (!object(row)) return;
  const m = provider === 'claude' ? row.message : row.payload;
  if (!object(m) || m.role !== 'assistant' || !Array.isArray(m.content)) return;
  if (provider === 'claude' && (row.type !== 'assistant' || row.sessionId !== sessionId || row.isSidechain || m.model === '<synthetic>')) return;
  if (provider === 'codex' && (row.type !== 'response_item' || m.type !== 'message' || m.phase !== 'final_answer' || m.status !== 'completed')) return;
  const kind = provider === 'claude' ? 'text' : 'output_text';
  // Mixed tool/reasoning blocks are not final prose. Fail closed on unknown formats.
  if (!m.content.length || !m.content.every((c: unknown) => object(c) && c.type === kind && typeof c.text === 'string')) return;
  const text = safeAssistantText(m.content.map((c: { text: string }) => c.text).join('\n'));
  const id = provider === 'claude' ? row.uuid : m.id;
  return text && typeof id === 'string' && id.length <= 200 ? { id: `${sessionId}:${id}`, text } : undefined;
}

/** Hook-selected root transcript only, bounded I/O, exact session, realpath containment, no scans. */
export function readAssistantReply(provider: 'claude' | 'codex', file: unknown, sessionId: unknown, home: unknown): AssistantReply | undefined {
  let fd: number | undefined;
  try {
    if (typeof file !== 'string' || typeof sessionId !== 'string' || typeof home !== 'string' || !path.isAbsolute(file) || !/^[\w-]{1,160}$/.test(sessionId)) return;
    const root = realpathSync(home), target = realpathSync(file);
    const parts = path.relative(root, target).split(path.sep);
    if (parts.includes('..') || path.isAbsolute(path.relative(root, target))) return;
    if (provider === 'claude' ? parts.length !== 3 || parts[0] !== 'projects' || parts[2] !== `${sessionId}.jsonl`
      : !['sessions', 'archived_sessions'].includes(parts[0]) || !path.basename(target).endsWith(`-${sessionId}.jsonl`)) return;
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return;
    if (provider === 'codex') {
      const header = Buffer.alloc(Math.min(stat.size, 65536));
      const n = readSync(fd, header, 0, header.length, 0), end = header.subarray(0, n).indexOf(10);
      if (end < 0) return;
      const meta = JSON.parse(header.subarray(0, end).toString('utf8'));
      if (meta.type !== 'session_meta' || meta.payload?.id !== sessionId) return;
    }
    const start = Math.max(0, stat.size - 1024 * 1024), tail = Buffer.alloc(stat.size - start);
    const n = readSync(fd, tail, 0, tail.length, start), lines = tail.subarray(0, n).toString('utf8').split('\n');
    lines.pop(); if (start) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      let row: unknown;
      try { row = JSON.parse(lines[i]); } catch { continue; }
      const reply = assistantRecord(provider, row, sessionId);
      if (reply) return reply;
      if (object(row) && (provider === 'claude' ? row.type === 'user' : row.type === 'response_item' && row.payload?.role === 'user')) return;
      // Do not replay a previous turn when the newest assistant reply is unsafe or unsupported.
      if (object(row) && (provider === 'claude' ? row.type === 'assistant' && !row.isSidechain : row.type === 'response_item' && row.payload?.role === 'assistant')) return;
    }
  } catch { /* Inaccessible, changed or unknown transcripts yield no spoken reply. */ }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** ACP text is buffered until a successful completed turn; never consume rendered terminal data. */
export class AssistantTurn {
  private text = '';
  private invalid = false;
  reset() { this.text = ''; this.invalid = false; }
  append(update: unknown) {
    if (!object(update) || update.sessionUpdate !== 'agent_message_chunk') return;
    if (!object(update.content) || update.content.type !== 'text' || typeof update.content.text !== 'string') { this.invalid = true; return; }
    if (this.text.length + update.content.text.length > 24000) { this.invalid = true; return; }
    this.text += update.content.text;
  }
  finish(): string | undefined { const text = this.invalid ? undefined : safeAssistantText(this.text); this.reset(); return text; }
}
