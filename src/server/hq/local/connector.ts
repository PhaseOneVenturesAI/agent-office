import { sendDesignImages } from '../../cubbies/local/design.js';
import type { DesignImage } from '../../drafts/image-format.js';
import { projectLock } from '../../cubbies/local/lock.js';
import { cubbyKey, ownerFingerprint } from '../../cubbies/wire.js';
import { friendlyName } from '../../cubbies/local/connector.js';
import { clean } from '../../cubbies/local/io.js';
import { verifyMac, type MacReady } from '../wire.js';
import { pinMac, type MacConfig } from './config.js';
import { macSnapshot } from './snapshot.js';
export class MacConnector {
  private images = new Map<number, Map<string, DesignImage>>();
  private sentImages = new Map<number, Set<string>>();
  private send?: (frame: unknown) => boolean | void;
  private timer?: NodeJS.Timeout;
  private generation = 0;
  private polling = false;
  private ready = false;
  private connections = new Set<string>();
  private release: () => void;
  private key: string;
  private closed = false;
  constructor(private config: MacConfig, token: string, private collect?: () => ReturnType<typeof macSnapshot>) {
    this.release = projectLock(config.state);
    try { pinMac(config); } catch (e) { this.release(); throw e; }
    this.key = cubbyKey(token);
  }
  get notice() { return `HQ owner key fingerprint: ${ownerFingerprint(this.config.ownerKey).match(/.{4}/g)!.join('-')}`; }
  connected(send: (frame: unknown) => boolean | void, name = friendlyName()) {
    if (this.closed) return;
    this.disconnected(); this.send = send;
    send({ t: 'hq.hello', computerId: this.config.computerId, computerName: clean(name, 60) });
  }
  receive(data: string | Buffer | ArrayBuffer | Buffer[]) {
    if (!this.send || this.ready || this.closed) return;
    let f: MacReady;
    try { const text = typeof data === 'string' ? data : Array.isArray(data) ? Buffer.concat(data).toString() : Buffer.from(data as ArrayBuffer).toString();
      if (text.length > 4096) return; f = JSON.parse(text); } catch { return; }
    if (f?.t !== 'hq.ready' || f.computerId !== this.config.computerId || !verifyMac(this.key, f) || typeof f.connection !== 'string' || this.connections.has(f.connection) || this.connections.size >= 16384) return;
    this.connections.add(f.connection);
    this.ready = true; void this.snapshot();
    this.timer = setInterval(() => void this.snapshot(), 15_000);
  }
  private async snapshot() {
    if (this.polling) return;
    const generation = this.generation; this.polling = true;
    try {
      const frame = await (this.collect?.() ?? macSnapshot(this.config, { images: this.images }));
      const current = () => this.ready && generation === this.generation;
      if (!current() || this.send?.(frame) === false) return;
      for (const [i, row] of frame.projects.entries()) {
        const sent = this.sentImages.get(i) ?? new Set<string>(); this.sentImages.set(i, sent);
        const hashes = new Set(row.pitch?.pieces.flatMap(p => [...p.images, ...(p.image ? [p.image] : [])]).map(i => i.hash));
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
