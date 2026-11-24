import { randomUUID } from 'node:crypto';
import type { ConversationMessage } from '../../shared/protocol.js';
import { safeAssistantText } from '../../shared/assistant-text.js';
import type { Worker } from './types.js';
import type { AssistantReply } from '../assistant-text.js';
import { RoleChat, type ChatMessage } from '../role-chat.js';

export const conversationSupported = (provider: unknown) => ['claude', 'kimi', 'codex'].includes(String(provider));
type Listener = (message: ConversationMessage) => void;
interface Feed { session?: string; messages: ConversationMessage[]; listeners: Set<Listener>; }

/**
 * A bounded, ephemeral view of this worker's new turns — plus, for role characters (the CEO and
 * department managers), a durable scoped history (see role-chat.ts) that survives restarts and
 * engine swaps. The provider session remains the source of execution context; the durable file is
 * the record, paged in on demand.
 */
export class WorkerConversations {
  private feeds = new Map<string, Feed>();
  private history?: RoleChat;
  private lastAssistant = new Map<string, string>();
  private durable?: (id: string) => boolean;
  private hydrated = new Set<string>();
  constructor(private workers: Map<string, Worker>, private prompt: (id: string, text: string, by: string) => string | undefined,
    private interrupt: (id: string, by: string) => void, private status: (w: Worker, status: 'working' | 'idle' | 'done') => void) {}

  /** Binds the durable store; `durable` says which workers keep a record (role characters). */
  attachHistory(history: RoleChat, durable: (id: string) => boolean): void {
    this.history = history;
    this.durable = durable;
  }

  private feed(id: string): Feed {
    let f = this.feeds.get(id);
    if (!f) { f = { messages: [], listeners: new Set() }; this.feeds.set(id, f); }
    const session = this.workers.get(id)?.info.sessionId;
    if (session && f.session !== session) { f.messages = []; f.session = session; this.hydrated.delete(id); }
    if (this.history && this.durable?.(id) && !this.hydrated.has(id)) {
      // Hydrate the live window from the durable record once; paging reaches further back.
      this.hydrated.add(id);
      f.messages = this.history.tail(id, 30).reverse();
    }
    return f;
  }
  snapshot(id: string) { return [...this.feed(id).messages]; }
  subscribe(id: string, listener: Listener) { const f = this.feed(id); f.listeners.add(listener); return () => f.listeners.delete(listener); }
  private append(id: string, message: ConversationMessage) {
    const f = this.feed(id);
    if (f.messages.some((m) => m.id === message.id)) return;
    f.messages.push(message);
    if (message.role === 'assistant') this.lastAssistant.set(id, message.text);
    while (f.messages.length > 30 || f.messages.reduce((n, m) => n + m.text.length, 0) > 100000) f.messages.shift();
    if (this.history && this.durable?.(id)) this.history.append(id, message as ChatMessage);
    for (const listener of f.listeners) listener(message);
  }
  /** The worker's latest complete assistant reply (durable record), for rollups to the CEO. */
  lastReply(id: string): string | undefined {
    const live = [...this.feed(id).messages].reverse().find((m) => m.role === 'assistant' && m.scope !== 'staff');
    if (live) return live.text;
    if (this.history && this.durable?.(id)) return this.history.tail(id, 30).find((m) => m.role === 'assistant' && m.scope !== 'staff')?.text;
    return undefined;
  }
  /** Older messages from the durable record (role characters); empty for ordinary workers. */
  page(id: string, before: number): ChatMessage[] {
    if (!this.history || !this.durable?.(id)) return [];
    return this.history.tail(id, 30, before);
  }
  assistant(id: string, reply: AssistantReply) {
    const w = this.workers.get(id), text = safeAssistantText(reply.text);
    if (!w || !conversationSupported(w.info.provider) || !text) return;
    this.append(id, { id: reply.id, role: 'assistant', text, at: Date.now() });
  }
  send(id: string, value: unknown, by: string, opts?: { scope?: 'staff'; preamble?: string }): string | undefined {
    const w = this.workers.get(id);
    if (!w || !conversationSupported(w.info.provider)) return 'Structured conversation is unavailable for this provider; use its terminal.';
    if (w.stopping || w.bootBlocked || w.info.lost || !['idle', 'done'].includes(w.info.status)) return 'Wait for the current turn or cleanup, or resolve the question in the terminal. This panel cannot answer tool approvals.';
    if (typeof value !== 'string' || !value.trim() || value.length > 20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return 'Enter a plain text prompt of at most 20,000 characters.';
    const text = value.trim(), previous = w.info.status as 'idle' | 'done';
    // A read-only question carries its constraints to the character, but the record keeps the
    // person's clean text under the staff scope — never in the controller-facing stream.
    const delivered = opts?.preamble ? `${opts.preamble}\n\n${text}` : text;
    // Reserve synchronously before another browser can send into this idle prompt.
    this.status(w, 'working');
    const error = this.prompt(id, delivered, by);
    if (error) { this.status(w, previous); return error; }
    this.append(id, { id: randomUUID(), role: 'user', text, at: Date.now(), by, ...(opts?.scope === 'staff' ? { scope: 'staff' } : {}) });
  }
  /** The staff-scoped view of a role character's record: read-only Q&A only. */
  snapshotScoped(id: string, scope: 'staff'): ConversationMessage[] {
    if (!this.history || !this.durable?.(id)) return [];
    return this.history.tail(id, 30).filter((m) => m.scope === scope).reverse();
  }
  stop(id: string, by: string): string | undefined {
    const w = this.workers.get(id);
    if (!w || w.stopping || w.info.status !== 'working') return 'Only a running turn can be interrupted here. Answer permissions in the terminal.';
    this.interrupt(id, by);
  }
  forget(id: string) { this.feeds.delete(id); this.hydrated.delete(id); }
}
