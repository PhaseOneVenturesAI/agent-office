import { randomUUID } from 'node:crypto';
import type { ConversationMessage } from '../../shared/protocol.js';
import { safeAssistantText } from '../../shared/assistant-text.js';
import type { Worker } from './types.js';
import type { AssistantReply } from '../assistant-text.js';

export const conversationSupported = (provider: unknown) => ['claude', 'kimi', 'codex'].includes(String(provider));
type Listener = (message: ConversationMessage) => void;
interface Feed { session?: string; messages: ConversationMessage[]; listeners: Set<Listener> }

/** A bounded, ephemeral view of this worker's new turns. The provider remains the source of history. */
export class WorkerConversations {
  private feeds = new Map<string, Feed>();
  constructor(private workers: Map<string, Worker>, private prompt: (id: string, text: string, by: string) => string | undefined,
    private interrupt: (id: string, by: string) => void, private status: (w: Worker, status: 'working' | 'idle' | 'done') => void) {}
  private feed(id: string): Feed {
    let f = this.feeds.get(id);
    if (!f) { f = { messages: [], listeners: new Set() }; this.feeds.set(id, f); }
    const session = this.workers.get(id)?.info.sessionId;
    if (session && f.session !== session) { f.messages = []; f.session = session; }
    return f;
  }
  snapshot(id: string) { return [...this.feed(id).messages]; }
  subscribe(id: string, listener: Listener) { const f = this.feed(id); f.listeners.add(listener); return () => f.listeners.delete(listener); }
  private append(id: string, message: ConversationMessage) {
    const f = this.feed(id);
    if (f.messages.some((m) => m.id === message.id)) return;
    f.messages.push(message);
    while (f.messages.length > 30 || f.messages.reduce((n, m) => n + m.text.length, 0) > 100000) f.messages.shift();
    for (const listener of f.listeners) listener(message);
  }
  assistant(id: string, reply: AssistantReply) {
    const w = this.workers.get(id), text = safeAssistantText(reply.text);
    if (!w || !conversationSupported(w.info.provider) || !text) return;
    this.append(id, { id: reply.id, role: 'assistant', text, at: Date.now() });
  }
  send(id: string, value: unknown, by: string): string | undefined {
    const w = this.workers.get(id);
    if (!w || !conversationSupported(w.info.provider)) return 'Structured conversation is unavailable for this provider; use its terminal.';
    if (w.bootBlocked || w.info.lost || !['idle', 'done'].includes(w.info.status)) return 'Wait for the current turn, or resolve the question in the terminal. This panel cannot answer tool approvals.';
    if (typeof value !== 'string' || !value.trim() || value.length > 20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return 'Enter a plain text prompt of at most 20,000 characters.';
    const text = value.trim(), previous = w.info.status as 'idle' | 'done';
    // Reserve synchronously before another browser can send into this idle prompt.
    this.status(w, 'working');
    const error = this.prompt(id, text, by);
    if (error) { this.status(w, previous); return error; }
    this.append(id, { id: randomUUID(), role: 'user', text, at: Date.now() });
  }
  stop(id: string, by: string): string | undefined {
    const w = this.workers.get(id);
    if (!w || w.info.status !== 'working') return 'Only a running turn can be interrupted here. Answer permissions in the terminal.';
    this.interrupt(id, by);
  }
  forget(id: string) { this.feeds.delete(id); }
}
