// Durable scoped history for role characters (the CEO and department managers): an append-only
// JSONL per worker in the floor's .agent-office folder, paged newest-first. The provider session
// stays the bounded execution context — this file is the record the role (and the people
// authorized for it) keeps across reconnects, restarts and engine swaps. Staff Q&A is written
// under its own scope so it never becomes part of the controller-facing record (see
// docs/department-leads.md).

import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** Who sent it (a person's name, or the character's own name for replies). */
  by?: string;
  /** 'staff' marks read-only Q&A; undefined is the controller-facing authoritative stream. */
  scope?: 'staff';
}

const MAX_TEXT = 20_000;
/** Generous bound per line; longer replies are clipped rather than refused. */
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

export class RoleChat {
  constructor(private dir: string) {}

  private file(workerId: string): string {
    return path.join(this.dir, `role-chat-${workerId}.jsonl`);
  }

  /** Appends one message; a malformed line can never take the file down (read skips bad lines). */
  append(workerId: string, message: ChatMessage): void {
    try {
      appendFileSync(this.file(workerId), `${JSON.stringify({ ...message, text: clip(message.text) })}\n`, { mode: 0o600 });
    } catch {
      // A full disk must not take the office down; the live conversation still works.
    }
  }

  /**
   * Moves a worker's record to a replacement (a landed engine swap): history follows the seat.
   * Transactional and chronological: all messages from both files are merged by timestamp into a
   * temp file, which replaces the target only after the whole merge is on disk; a failure leaves
   * both originals intact. Resolves true when the record now lives at `toId`.
   */
  migrate(fromId: string, toId: string, preserveSource = false): boolean {
    const from = this.file(fromId), to = this.file(toId);
    if (from === to) return true;
    if (!existsSync(from)) return true;
    const temp = `${to}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      const parse = (file: string) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.trim())
          .map((line) => {
            try {
              return JSON.parse(line) as ChatMessage;
            } catch {
              return undefined;
            }
          })
          .filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && Number.isFinite(m.at));
      const merged = [...new Map([...parse(from), ...(existsSync(to) ? parse(to) : [])].map((m) => [m.id, m])).values()].sort((a, b) => a.at - b.at);
      writeFileSync(temp, merged.map((m) => JSON.stringify(m)).join('\n') + '\n', { mode: 0o600 });
      renameSync(temp, to);
      if (!preserveSource) rmSync(from);
      return true;
    } catch {
      rmSync(temp, { force: true });
      return false;
    }
  }

  /** The newest `n` messages before `before` (exclusive), newest first. */
  tail(workerId: string, n = 30, before?: number): ChatMessage[] {
    if (!existsSync(this.file(workerId))) return [];
    let lines: string[] = [];
    try {
      lines = readFileSync(this.file(workerId), 'utf8').split('\n');
    } catch {
      return [];
    }
    const out: ChatMessage[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const m = JSON.parse(line) as ChatMessage;
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string' || !Number.isFinite(m.at)) continue;
        if (before !== undefined && m.at >= before) continue;
        out.push({ id: String(m.id), role: m.role, text: m.text, at: m.at, ...(m.by ? { by: String(m.by) } : {}), ...(m.scope === 'staff' ? { scope: 'staff' as const } : {}) });
      } catch {
        // Skip a corrupt line, keep paging.
      }
    }
    return out;
  }
}
