// Durable scoped history for role characters (the CEO and department managers): an append-only
// JSONL per worker in the floor's .agent-office folder, paged newest-first. The provider session
// stays the bounded execution context — this file is the record the role (and the people
// authorized for it) keeps across reconnects, restarts and engine swaps. Staff Q&A is written
// under its own scope so it never becomes part of the controller-facing record (see
// docs/department-leads.md).

import { appendFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
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

  /** Moves a worker's record to a replacement (a landed engine swap): history follows the seat. */
  migrate(fromId: string, toId: string): void {
    const from = this.file(fromId), to = this.file(toId);
    if (from === to || !existsSync(from)) return;
    try {
      if (existsSync(to)) {
        const lines = readFileSync(from, 'utf8');
        appendFileSync(to, lines.endsWith('\n') || !lines.trim() ? lines : `${lines}\n`, { mode: 0o600 });
        rmSync(from);
      } else {
        renameSync(from, to);
      }
    } catch {
      // A failed move leaves the source file intact; nothing is lost.
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
