import type { DeliveryRun, DeliveryState } from '../../shared/protocol/delivery.js';
import { readRuns, refKey, type DeliveryRef, type RunsReader } from './runs.js';

export const DELIVERY_REFRESH_MS = 60_000;
export const WATCH_LEASE_MS = 150_000;
export interface Watcher { id: string; name: string }
interface Lease { owner: Watcher; expiresAt: number }
interface Entry {
  ref: DeliveryRef;
  runs: DeliveryRun[];
  fetchedAt: number;
  askedAt?: number;
  error?: string;
  flight?: Promise<void>;
  leases: Map<string, Lease>;
  listeners: Set<() => void>;
}

/** Evidence attached to existing PRs, not a queue. One reader per repo + exact source SHA. */
export class Deliveries {
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout;
  constructor(private read: RunsReader = readRuns, private now = Date.now) {
    this.timer = setInterval(() => this.tick(), DELIVERY_REFRESH_MS);
    this.timer.unref();
  }
  private entry(ref: DeliveryRef): Entry {
    const key = refKey(ref);
    let entry = this.entries.get(key);
    if (!entry) {
      // Bounded cache; active readers/leases are never silently displaced.
      if (this.entries.size >= 100) {
        const idle = [...this.entries].find(([, e]) => !e.listeners.size && !e.flight && !this.active(e));
        if (idle) this.entries.delete(idle[0]);
        else throw new Error('Delivery readers are busy; close an unused evidence panel');
      }
      entry = { ref, runs: [], fetchedAt: 0, leases: new Map(), listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }
  state(ref: DeliveryRef, viewer: string): DeliveryState {
    const e = this.entry(ref);
    return { number: ref.number, repo: ref.repo, sourceSha: ref.sha, fetchedAt: e.fetchedAt, loading: !!e.flight, error: e.error, runs: e.runs.map((run) => {
      const lease = e.leases.get(run.key);
      return { ...run, ...(lease && lease.expiresAt > this.now() ? { watcher: { name: lease.owner.name, mine: lease.owner.id === viewer, expiresAt: lease.expiresAt } } : {}) };
    }) };
  }
  subscribe(ref: DeliveryRef, listener: () => void): () => void {
    const e = this.entry(ref);
    e.listeners.add(listener);
    return () => e.listeners.delete(listener);
  }
  private emit(e: Entry) { for (const listener of [...e.listeners]) listener(); }
  refresh(ref: DeliveryRef): Promise<void> {
    const e = this.entry(ref);
    if (e.flight) return e.flight;
    if (e.askedAt !== undefined && this.now() - e.askedAt < DELIVERY_REFRESH_MS) return Promise.resolve();
    e.askedAt = this.now();
    // Assign the shared promise before running an injected reader (including synchronous throws).
    e.flight = Promise.resolve().then(() => this.read(ref)).then((runs) => {
      e.runs = runs;
      e.fetchedAt = this.now();
      e.error = undefined;
      for (const key of e.leases.keys()) if (!runs.some((r) => r.key === key && r.status !== 'completed')) e.leases.delete(key);
    }).catch(() => { e.error = 'Could not read GitHub runs. Check server GitHub read access; existing evidence is retained.'; }).finally(() => { e.flight = undefined; this.emit(e); });
    this.emit(e);
    return e.flight;
  }
  claim(ref: DeliveryRef, key: string, owner: Watcher): string | undefined {
    const e = this.entry(ref);
    const run = e.runs.find((r) => r.key === key);
    if (!run) return 'Refresh and choose an existing GitHub run';
    if (run.status === 'completed') return 'This run is complete; reuse its recorded result';
    const lease = e.leases.get(key);
    if (lease && lease.expiresAt > this.now() && lease.owner.id !== owner.id) return 'Someone already watches this run; reuse their result';
    e.leases.set(key, { owner, expiresAt: this.now() + WATCH_LEASE_MS });
    this.emit(e);
    return;
  }
  renew(ref: DeliveryRef, key: string, owner: string): void {
    const e = this.entry(ref), lease = e.leases.get(key);
    if (lease?.owner.id !== owner || lease.expiresAt <= this.now()) return;
    lease.expiresAt = this.now() + WATCH_LEASE_MS;
    this.emit(e);
  }
  release(ref: DeliveryRef, key: string, owner: string): void {
    const e = this.entry(ref);
    if (e.leases.get(key)?.owner.id !== owner) return;
    e.leases.delete(key);
    this.emit(e);
  }
  releaseOwner(owner: string): void {
    for (const e of this.entries.values()) {
      let changed = false;
      for (const [key, l] of e.leases) if (l.owner.id === owner) { e.leases.delete(key); changed = true; }
      if (changed) this.emit(e);
    }
  }
  private active(e: Entry) { return [...e.leases.values()].some((l) => l.expiresAt > this.now()); }
  tick(): void {
    for (const e of this.entries.values()) {
      for (const [key, l] of e.leases) if (l.expiresAt <= this.now()) e.leases.delete(key);
      if (this.active(e)) void this.refresh(e.ref);
      this.emit(e);
    }
  }
  close(): void { clearInterval(this.timer); this.entries.clear(); }
}
