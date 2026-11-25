import { canViewTerminal } from '../worker-ownership.js';
import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { FloorDef } from '../building.js';
import { Floor, type FloorContext } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorInfo, ServerMsg } from '../../shared/protocol.js';
import type { Ctx, FloorHelpers, FloorsOpen } from './context.js';
import { SLOW_CLIENT_BYTES, type Client } from './client.js';
import { NEW_BADGE_MS } from '../../shared/protocol/drafts.js';

/** Finding floors, the elevator's list of them, and taking one off the building. */
export function floorHelpers(ctx: Ctx): FloorHelpers {
  const floorVisible = (id: string, c: Pick<Client, 'accountId'>): boolean => {
    const def = ctx.floors.get(id)?.def ?? ctx.building.list().find(d => d.id === id);
    return !def?.draft || !!ctx.drafts?.owns(id, c.accountId);
  };
  const floorOf = (c: Client): Floor | undefined => (c.peer.floor && floorVisible(c.peer.floor, c) ? ctx.floors.get(c.peer.floor) : undefined);
  /** The floor a worker sits on. Worker ids are unique across the building. */
  const workerFloor = (workerId: string): Floor | undefined => {
    for (const f of ctx.floors.values()) if (f.workers.get(workerId)) return f;
    return undefined;
  };
  let badgeTimer: NodeJS.Timeout | undefined;
  const floorInfos = (c: Pick<Client, 'accountId'> = {}): FloorInfo[] => {
    if (!badgeTimer && ctx.drafts) {
      const expiry = Math.min(...[...ctx.floors.keys()].filter(id => ctx.drafts.isNew(id))
        .map(id => ctx.drafts.records.rows.get(id)!.kickedOffAt! + NEW_BADGE_MS));
      if (Number.isFinite(expiry)) badgeTimer = setTimeout(() => { badgeTimer = undefined; floorsChanged(); }, Math.max(1, expiry - Date.now()));
      badgeTimer?.unref();
    }
    return [
      ...[...ctx.floors.values()].map((f) => ({ ...f.info(), ...(f.def.draft ? { draft: true as const } : {}), ...(ctx.drafts?.isNew(f.id) ? { isNew: true as const } : {}), ...(ctx.building.isLocal(f.id) ? { local: true } : {}) })),
      ...ctx.building.pending().map((d) => ({ id: d.id, name: d.name, repo: d.repo, dir: d.dir, palette: d.palette, addedBy: d.addedBy, addedAt: d.addedAt, cloning: true, clone: ctx.building.cloneProgress(d.id), workers: 0, busy: 0, waiting: 0, people: 0, wing: 0 })),
    ].filter(f => floorVisible(f.id, c));
  };
  // The elevator's counts change with every worker update; tell everyone at most a few times a second.
  const floorsSent = new WeakMap<Client, string>();
  let floorsTimer: NodeJS.Timeout | undefined;
  const floorsChanged = () => {
    floorsTimer ??= setTimeout(() => {
      floorsTimer = undefined;
      for (const c of ctx.clients.values()) {
        const list = floorInfos(c), json = JSON.stringify(list);
        if (json === floorsSent.get(c)) continue;
        floorsSent.set(c, json);
        ctx.sendTo(c, { t: 'floors', floors: list });
      }
    }, 250);
  };
  /** Where someone arriving goes: the floor they asked for, else the first one there is. */
  const arrivalFloor = (wanted: string | null, c: Pick<Client, 'accountId'> = {}): Floor | undefined =>
    (wanted && floorVisible(wanted, c) && ctx.floors.get(wanted)) || [...ctx.floors.values()].find(f => floorVisible(f.id, c));

  const closing = new Map<Floor, Promise<string | undefined>>();
  /**
   * Stops `floor` before removing it from floors.json: everyone on it rides the elevator to
   * the next floor, or out to the lobby if it was the last (the roof goes with it), and its workers stop.
   */
  const removeFloor = async (floor: Floor, who: string): Promise<string | undefined> => {
    try { await floor.shutdown(); }
    catch (error) { return `Kept ${floor.def.name}: its workers did not stop (${String(error)})`; }
    const removed = ctx.building.remove(floor.id, who);
    if (typeof removed === 'string') return removed;
    const name = floor.def.name;
    // The list without it first, so nobody arrives somewhere (the lobby's panel) that still shows it.
    for (const c of ctx.clients.values()) {
      const list = floorInfos(c).filter(f => f.id !== floor.id);
      floorsSent.set(c, JSON.stringify(list));
      ctx.sendTo(c, { t: 'floors', floors: list });
      if (!floorVisible(floor.id, c)) continue;
      const next = [...ctx.floors.values()].find(f => f !== floor && floorVisible(f.id, c));
      if (c.peer.floor === floor.id || (!next && c.peer.floor === ROOF)) {
        if (next) ctx.goToFloor(c, next);
        else ctx.toLobby(c);
        ctx.sendTo(c, { t: 'toast', text: next ? `🛗 ${who} took ${name} off the building, so you rode the elevator to ${next.def.name}` : `🛗 ${who} took ${name}, the last floor, off the building`, level: 'warn' });
      } else ctx.sendTo(c, { t: 'toast', text: `🛗 ${who} took ${name} off the building`, level: 'info' });
    }
    ctx.floors.delete(floor.id);
    ctx.cubbies?.dropDraftImages(floor.id);
    floorsChanged();
    // Its workers made room under the worker limit.
    ctx.pumpQueues();
  };

  const closeFloor = (floor: Floor, who: string): Promise<string | undefined> => {
    if (ctx.drafts?.isKicking(floor.id)) return Promise.resolve('Wait for kickoff to finish before removing this floor');
    const existing = closing.get(floor);
    if (existing) return existing;
    const task = removeFloor(floor, who);
    closing.set(floor, task);
    void task.then(() => closing.delete(floor), () => closing.delete(floor));
    return task;
  };

  return { floorVisible, floorOf, workerFloor, floorInfos, floorsChanged, cancelFloorsChanged: () => { clearTimeout(floorsTimer); clearTimeout(badgeTimer); }, arrivalFloor, closeFloor };
}

/**
 * Opens every floor of the building, with what they need of the office (see FloorContext), and waits
 * until the workers still running from the last office are back at their desks.
 */
export async function openFloors(ctx: Ctx, hookPort: number): Promise<FloorsOpen> {
  const { cfg, floors, clients } = ctx;
  const floorContext: FloorContext = {
    agentCmd: cfg.agentCmd,
    agentArgs: cfg.agentArgs,
    dshProfile: cfg.dshProfile,
    hook: { url: `http://127.0.0.1:${hookPort}`, token: '' },
    ledger: ctx.ledger,
    capacity: ctx.machine,
    prompts: ctx.prompts,
    emit: ctx.toFloor,
    toast: ctx.toastFloor,
    termData: (workerId, data, viewers) => {
      const json = JSON.stringify({ t: 'term.data', workerId, data } satisfies ServerMsg);
      for (const id of viewers) {
        const c = clients.get(id);
        if (!c || c.ws.readyState !== WebSocket.OPEN || !canViewTerminal(ctx, c.accountId, workerId)) continue;
        // A viewer on a slow link skips output and gets a fresh snapshot once it catches up,
        // instead of queueing unbounded data in server memory.
        if (c.stale.has(workerId) || c.ws.bufferedAmount > SLOW_CLIENT_BYTES) c.stale.add(workerId);
        else c.ws.send(json);
      }
    },
    changes: (state, ids) => {
      for (const id of ids) {
        const c = clients.get(id);
        if (c) ctx.sendTo(c, { t: 'changes', state });
      }
    },
    workerChanged: (floor, w) => {
      if (typeof w === 'string') {
        ctx.webhook.onWorkerGone(w);
        ctx.pumpQueues(floor);
      } else ctx.webhook.onWorker(w);
      ctx.machine.workersChanged();
      ctx.floorsChanged();
    },
    people: (floor) => {
      let n = 0;
      for (const c of clients.values()) if (c.peer.floor === floor.id) n++;
      return n;
    },
    peers: (floor) => [...clients.values()].filter((c) => c.peer.floor === floor.id).map((c) => c.peer),
    leaveOnMerge: () => ctx.leaveOnMerge.on,
    floor: (id) => floors.get(id),
    pullsChanged: (floor) => {
      for (const f of floors.values()) if (f !== floor && worksIn(f, floor)) f.sendLandedHome();
    },
    lent: (floor) => [...floors.values()].some((f) => f !== floor && worksIn(f, floor)),
    locksUp: () => !!ctx.maps.plan().sendHome?.keeps,
    runAs: ctx.signins,
    ghAs: (owner) => (owner ? ctx.signins.ghAs(owner) : undefined),
  };
  /** Whether a worker on `from` works in `on`'s project too (see WorkerInfo.repos). */
  const worksIn = (from: Floor, on: Floor) => from.workers.list().some((w) => w.repos?.some((r) => r.floor === on.id));
  const openFloor = (def: FloorDef): Floor | undefined => {
    if (def.draft && !ctx.drafts.enabled) return undefined;
    if (!existsSync(def.dir)) {
      console.error(`agent-office: the ${def.name} floor's checkout is gone (${def.dir}) — it stays closed until it's back`);
      return undefined;
    }
    try {
      const floor = new Floor(def, floorContext);
      floors.set(def.id, floor);
      return floor;
    } catch (err) {
      console.error(`agent-office: couldn't open the ${def.name} floor: ${(err as Error).message}`);
      return undefined;
    }
  };
  // Started in a project: it's a floor too (the one it has always been).
  if (cfg.project) ctx.building.ensureLocal(cfg.project, 'the office');
  for (const def of ctx.building.list()) openFloor(def);
  // Clones keep the elevator's progress up to date, and ones the last office left running carry on.
  ctx.building.watchClones(ctx.floorsChanged);
  ctx.building.resumeClones((r) => {
    ctx.floorsChanged();
    if (typeof r === 'string') {
      console.error(`agent-office: ${r}`);
      return ctx.toastAll(`🛗 ${r}`, 'warn');
    }
    if (!openFloor(r)) return;
    console.log(`  the ${r.name} floor's clone finished (${r.dir})`);
    ctx.toastAll(`🛗 New floor: ${r.name}, added by ${r.addedBy}`);
  });
  // Workers still running from the last office are back at their desks before anyone walks in.
  await Promise.all([...floors.values()].map((f) => f.ready));
  return { openFloor };
}
