import { cleanLeadFrame, cleanLeadSend, type LeadReply, type LeadSend, type LeadStateFrame } from '../../shared/protocol/lead-talk.js';
import { LeadError } from '../cubbies/local/lead.js';
import type { MacConfig } from '../hq/local/config.js';
import type { SessionRecord } from '../hq/local/sessions.js';
import { harnessState, startActivity, type Activity } from './activity.js';
import { sendHeadless } from './headless.js';
import { removeMarker, sendInbox, writeMarker } from './inbox.js';
import { liveSession, resolveTarget, type LocalTarget } from './targets.js';

export interface TalkClock {
  now(): number;
  after(fn: () => void, ms: number): () => void;
}
const systemClock: TalkClock = { now: Date.now, after(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return () => clearTimeout(timer); } };
export interface TalkOptions {
  stateDirectory?: string; platform?: string; clock?: TalkClock;
  resolve?: (frame: LeadSend) => LocalTarget;
  live?: (target: LocalTarget) => SessionRecord | undefined;
  inbox?: typeof sendInbox;
  headless?: typeof sendHeadless;
}
interface Turn {
  frame: LeadSend; target: LocalTarget; abort: AbortController; done: boolean;
  session?: string; delivered?: boolean; reply?: string; workingAt?: number;
  cancelTimeout?: () => void; wake?: () => void;
}
/** One outstanding turn per native identity, up to five waiting; twenty total. */
export class LeadTalk {
  private queues = new Map<string, Turn[]>();
  private pending = new Map<string, Turn>();
  private ids = new Set<string>();
  private jobs = new Set<Promise<void>>();
  private closed = false;
  private clock: TalkClock;
  readonly stateDirectory: string;
  constructor(private config: MacConfig, private send: (frame: LeadStateFrame | LeadReply) => unknown, private options: TalkOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.stateDirectory = options.stateDirectory ?? harnessState(config.home);
  }
  receive(raw: unknown) {
    const frame = cleanLeadSend(raw);
    if (!frame || this.closed || this.ids.has(frame.id)) return;
    if ((this.options.platform ?? process.platform) !== 'darwin') return this.failed(frame, 'Talking to leads is available on the linked Mac');
    let target: LocalTarget;
    try {
      target = (this.options.resolve ?? (f => resolveTarget(this.config, f.target)))(frame);
      const live = this.live(target);
      // A bridge-only and a native-id target for the same process share one queue.
      if (live?.sessionId) target = { ...target, key: live.sessionId };
    } catch (e) { return this.failed(frame, this.error(e)); }
    const queue = this.queues.get(target.key) ?? [];
    if (queue.length >= 6 || this.ids.size >= 20) return this.failed(frame, 'Too many waiting messages');
    const turn: Turn = { frame, target, abort: new AbortController(), done: false };
    this.ids.add(frame.id); queue.push(turn); this.queues.set(target.key, queue);
    if (queue.length === 1) this.launch(turn); else this.state(turn, 'queued');
  }
  private live(target: LocalTarget) { return (this.options.live ?? (t => liveSession(this.config.home, t)))(target); }
  private error(e: unknown) { return e instanceof LeadError ? e.message : 'Could not reach this lead; check the Claude app'; }
  private emit(frame: LeadStateFrame | LeadReply) { const clean = cleanLeadFrame(frame); if (!this.closed && clean) this.send(clean); }
  private failed(frame: LeadSend, error: string) { this.emit({ t: 'lead.state', id: frame.id, state: 'failed', error }); }
  private state(turn: Turn, state: LeadStateFrame['state'], path?: LeadStateFrame['path']) { if (!turn.done) this.emit({ t: 'lead.state', id: turn.frame.id, state, ...(path ? { path } : {}) }); }
  private launch(turn: Turn) {
    const job = this.deliver(turn);
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
  }
  private sleep(turn: Turn, ms: number) {
    return new Promise<void>(resolve => {
      const cancel = this.clock.after(() => { turn.wake = undefined; resolve(); }, ms);
      turn.wake = () => { cancel(); turn.wake = undefined; resolve(); };
    });
  }
  private async deliver(turn: Turn) {
    try {
      const until = this.clock.now() + 10 * 60_000;
      let record: SessionRecord | undefined;
      while (!turn.done) {
        // Resolve again after queueing: hidden/archived projects and changed leads cannot receive stale work.
        const current = (this.options.resolve ?? (f => resolveTarget(this.config, f.target)))(turn.frame);
        if (current.sessionId !== turn.target.sessionId || current.appSession !== turn.target.appSession || current.project !== turn.target.project) throw new LeadError('The registered lead changed; send the message again');
        record = this.live(current);
        if (!record || record.status === 'idle') break;
        if (this.clock.now() >= until) throw new LeadError('The lead stayed busy; try again');
        this.state(turn, 'queued'); await this.sleep(turn, 2000);
      }
      if (turn.done) return;
      if (!record) {
        if (!turn.target.sessionId) throw new LeadError('Open this lead in the Claude app once so it can be reached');
        if (!turn.target.project) throw new LeadError('Cofounder has no registered project folder for headless resume');
        const result = (this.options.headless ?? sendHeadless)(this.config, turn.target, turn.frame, turn.abort.signal);
        this.state(turn, 'delivered', 'headless');
        const reply = await result;
        if (!turn.done) { this.emit({ t: 'lead.reply', id: turn.frame.id, text: reply }); this.finish(turn); }
        return;
      }
      if (!record.sessionId) throw new LeadError('The lead has no reachable native session');
      if (this.pending.has(record.sessionId)) throw new LeadError('This lead already has a waiting message');
      writeMarker(this.stateDirectory, record.sessionId, turn.frame.id);
      turn.session = record.sessionId; this.pending.set(record.sessionId, turn);
      turn.cancelTimeout = this.clock.after(() => {
        if (!turn.done) { this.failed(turn.frame, 'No reply yet; check the lead in the Claude app'); this.finish(turn); }
      }, 20 * 60_000);
      await (this.options.inbox ?? sendInbox)(this.config.home, record, turn.frame, turn.abort.signal);
      if (turn.done) return;
      turn.delivered = true; this.state(turn, 'delivered', 'inbox');
      // A fast Stop can arrive before the one-second socket close.
      if (turn.reply) this.reply(turn, turn.reply);
    } catch (e) { if (!turn.done) { this.failed(turn.frame, this.error(e)); this.finish(turn); } }
  }
  activity = (event: Activity) => {
    const turn = this.pending.get(event.sessionId);
    if (!turn || turn.done) return;
    if (event.event === 'Stop' && event.turn === turn.frame.id && event.reply?.trim()) {
      if (turn.delivered) this.reply(turn, event.reply); else turn.reply = event.reply;
    } else if (['PreToolUse', 'UserPromptSubmit', 'Notification'].includes(event.event) &&
      (turn.workingAt === undefined || this.clock.now() - turn.workingAt >= 5000)) {
      turn.workingAt = this.clock.now(); this.state(turn, 'working');
    }
  };
  private reply(turn: Turn, text: string) { this.emit({ t: 'lead.reply', id: turn.frame.id, text }); this.finish(turn); }
  private finish(turn: Turn) {
    if (turn.done) return; turn.done = true;
    turn.abort.abort(); turn.cancelTimeout?.(); turn.wake?.();
    if (turn.session) {
      if (this.pending.get(turn.session) === turn) this.pending.delete(turn.session);
      removeMarker(this.stateDirectory, turn.session, turn.frame.id);
    }
    this.ids.delete(turn.frame.id);
    const queue = this.queues.get(turn.target.key);
    if (queue) {
      const index = queue.indexOf(turn); if (index >= 0) queue.splice(index, 1);
      if (!queue.length) this.queues.delete(turn.target.key);
      else if (index === 0 && !this.closed) this.launch(queue[0]);
    }
  }
  async close() {
    this.closed = true;
    for (const queue of [...this.queues.values()]) for (const turn of [...queue]) this.finish(turn);
    await Promise.allSettled(this.jobs);
  }
}
export async function startLeadTalk(config: MacConfig, send: (frame: LeadStateFrame | LeadReply) => unknown, options: TalkOptions = {}) {
  const talk = new LeadTalk(config, send, options);
  const server = await startActivity(talk.stateDirectory);
  server.activity.on('activity', talk.activity);
  return { talk, activity: server.activity, async close() { await talk.close(); await server.close(); } };
}
