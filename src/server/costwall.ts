// The cost wall: who is spending what, per person and per provider (☰ → 💸 Cost wall). Every
// agent's session usage — tokens, and dollars where the provider can price them — is added up by
// who hired it and what it runs, next to the office ledger's all-time and today (the ledger
// tracks Claude spend, workers sent home included; the wall itself is the live picture). The
// numbers recompute from the workers at their desks, so a refresh is never stale, and a slow
// timer broadcasts the wall when they moved.

import type { AgentProvider } from '../shared/providers.js';
import type { CostwallCell, CostwallRow, CostwallState, Usage, WorkerInfo } from '../shared/protocol.js';
import { addUsage, zeroUsage, type Ledger } from './usage.js';
import type { Floor } from './floor.js';

/** How often the wall checks whether the numbers moved. */
const REFRESH_MS = 20_000;

interface Sum {
  usage: Usage;
  workers: number;
  /** Workers with a usage report at all (a fresh hire has none yet). */
  reported: number;
  /** How many of them brought an authoritative totalTokens (kept only when all did). */
  withTotal: number;
  costKnown: boolean;
}

const newSum = (): Sum => ({ usage: zeroUsage(), workers: 0, reported: 0, withTotal: 0, costKnown: true });

/** Adds one worker's session into the sum, in place. */
function addWorker(sum: Sum, w: WorkerInfo): void {
  sum.workers += 1;
  const u = w.usage;
  if (!u) return;
  sum.reported += 1;
  // addUsage sums the six base fields into a fresh object: reasoning and totalTokens ride along by hand.
  const reasoning = (sum.usage.reasoning ?? 0) + (u.reasoning ?? 0);
  const total = (sum.usage.totalTokens ?? 0) + (u.totalTokens ?? 0);
  sum.usage = addUsage(sum.usage, u);
  if (reasoning) sum.usage.reasoning = reasoning;
  if (u.totalTokens !== undefined) {
    sum.usage.totalTokens = total;
    sum.withTotal += 1;
  }
  if (u.costKnown === false) sum.costKnown = false;
  if (u.callsKnown === false) sum.usage.callsKnown = false;
  if (u.incomplete) sum.usage.incomplete = true;
}

/** A mixed sum's totalTokens only means something when every reporter brought one. */
function finish(sum: Sum): Usage {
  if (sum.withTotal !== sum.reported) delete sum.usage.totalTokens;
  return sum.usage;
}

/**
 * The wall from the workers at their desks right now: one row per person, a cell per provider
 * they run, biggest known spend first. Pure, so the tests drive it with made-up workers.
 */
export function aggregate(workers: WorkerInfo[], ledger: Ledger): CostwallState {
  const byName = new Map<string, { providers: Map<AgentProvider, Sum>; total: Sum }>();
  const office = newSum();
  for (const w of workers) {
    if (w.kind !== 'agent' || !w.provider) continue;
    let row = byName.get(w.createdBy);
    if (!row) {
      row = { providers: new Map(), total: newSum() };
      byName.set(w.createdBy, row);
    }
    const cell = row.providers.get(w.provider) ?? newSum();
    row.providers.set(w.provider, cell);
    for (const sum of [cell, row.total, office]) addWorker(sum, w);
  }
  const rows: CostwallRow[] = [...byName.entries()].map(([name, row]) => ({
    name,
    providers: Object.fromEntries([...row.providers.entries()].map(([p, s]) => [p, { workers: s.workers, usage: finish(s), costKnown: s.costKnown } satisfies CostwallCell])),
    total: finish(row.total),
    costKnown: row.total.costKnown,
  }));
  rows.sort((a, b) => b.total.cost - a.total.cost || a.name.localeCompare(b.name));
  return { rows, office: finish(office), costKnown: office.costKnown, ledger: ledger.state() };
}

export class Costwall {
  private last = '';
  private timer: NodeJS.Timeout;

  constructor(
    private readonly building: () => Floor[],
    private readonly ledger: Ledger,
    private onChange: () => void,
  ) {
    // Spend moves as the sessions move; the wall follows on its own slow clock.
    this.timer = setInterval(() => this.moved(), REFRESH_MS);
    this.timer.unref?.();
  }

  state(): CostwallState {
    return aggregate(this.building().flatMap((f) => f.workers.list()), this.ledger);
  }

  /** Broadcasts the wall when the numbers moved since the last one went out. */
  private moved() {
    const state = this.state();
    const json = JSON.stringify(state.rows) + JSON.stringify(state.office);
    if (json === this.last) return;
    this.last = json;
    this.onChange();
  }

  close() {
    clearInterval(this.timer);
  }
}
