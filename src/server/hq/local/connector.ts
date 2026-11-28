import { sendDesignImages } from '../../cubbies/local/design.js';
import type { DesignImage } from '../../drafts/image-format.js';
import { projectLock } from '../../cubbies/local/lock.js';
import { cubbyKey } from '../../cubbies/wire.js';
import { friendlyName } from '../../cubbies/local/connector.js';
import { clean } from '../../cubbies/local/io.js';
import { verifyMac, type MacReady } from '../wire.js';
import { type MacConfig } from './config.js';
import { macSnapshot } from './snapshot.js';
import type { LeadReply, LeadStateFrame } from '../../../shared/protocol/lead-talk.js';
export class MacConnector {
  private images = new Map<number, Map<string, DesignImage>>();
  private sentImages = new Map<number, Set<string>>();
  private send?: (frame: unknown) => boolean | void;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private polling = false;
  private hasDrafts = false;
  private lastSnapshot = 0;
  private ready = false;
  private connections = new Set<string>();
  private release: () => void;
  private key: string;
  private closed = false;
  constructor(private config: MacConfig, token: string, private collect?: () => ReturnType<typeof macSnapshot>, private talk?: (frame: unknown) => void) {
    this.release = projectLock(config.state);
    this.key = cubbyKey(token);
  }
  connected(send: (frame: unknown) => boolean | void, name = friendlyName()) {
    if (this.closed) return;
    this.disconnected(); this.send = send;
    send({ t: 'hq.hello', computerId: this.config.computerId, computerName: clean(name, 60) });
  }
  receive(data: string | Buffer | ArrayBuffer | Buffer[]) {
    if (!this.send || this.closed) return;
    let f: MacReady;
    try { const text = typeof data === 'string' ? data : Array.isArray(data) ? Buffer.concat(data).toString() : Buffer.from(data as ArrayBuffer).toString();
      if (text.length > 32768) return; f = JSON.parse(text); } catch { return; }
    if (this.ready) { this.talk?.(f); return; }
    if (f?.t !== 'hq.ready' || f.computerId !== this.config.computerId || !verifyMac(this.key, f) || typeof f.connection !== 'string' || this.connections.has(f.connection)) return;
    if (this.connections.size >= 256) this.connections.delete(this.connections.values().next().value!);
    this.connections.add(f.connection);
    this.ready = true; void this.snapshot();
    this.timer = setInterval(() => { if (this.hasDrafts || Date.now() - this.lastSnapshot >= 15_000) void this.snapshot(); }, 3000);
  }
  sendActivity(frame: import('../../../shared/protocol/live-work.js').HQActivity) { return this.ready && !this.closed ? this.send?.(frame) : false; }
  sendLead(frame: LeadStateFrame | LeadReply | import('../../../shared/protocol/studio.js').ProjectResult) { return this.ready && !this.closed ? this.send?.(frame) : false; }
  async snapshot() {
    if (this.polling) return;
    const generation = this.generation; this.polling = true;
    try {
      const frame = await (this.collect?.() ?? macSnapshot(this.config, { images: this.images }));
      this.hasDrafts = frame.projects.some(p => p.project.localState === 'draft'); this.lastSnapshot = Date.now();
      const current = () => this.ready && generation === this.generation;
      if (!current() || this.send?.(frame) === false) return;
      for (const [i, row] of frame.projects.entries()) {
        const sent = this.sentImages.get(i) ?? new Set<string>(); this.sentImages.set(i, sent);
        const hashes = new Set([...(row.pitch?.pieces.flatMap(p => [...p.images, ...(p.image ? [p.image] : [])]).map(i => i.hash) ?? []), ...[...(row.draft?.ideas ?? []), ...(row.draft?.screens ?? [])].flatMap(c => c.image ? [c.image.hash] : [])]);
        const images = [...this.images.get(i)?.values() ?? []].filter(image => hashes.has(image.meta.hash));
        await sendDesignImages('hq', images, sent, f => this.send?.({ ...f, t: 'hq.image', projectIndex: i, computerId: this.config.computerId }), current);
      }
    }
    catch { /* retry on the normal cycle; no empty snapshot on a failed registry read */ }
    finally { this.polling = false; }
  }
  disconnected() { this.sentImages.clear(); this.generation++; this.ready = false; this.send = undefined; clearInterval(this.timer); this.timer = undefined; }
  async close() { if (this.closed) return; this.closed = true; this.disconnected(); this.release(); }
}
