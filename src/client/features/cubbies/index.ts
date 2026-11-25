/**
 * Cubbies: a private room per person, computer and floor, in the cubby hall the root builds. Each of
 * the six slots shows its owner's name, lamp and how many are working; yours has your computer, your
 * lead and every agent in the project's folder on it, and E talks to the lead or checks on a helper.
 * A free one sets up with E. Nothing here shows, collides or answers E while the floor has no hall
 * (store.cubbies.enabled) or the hall hasn't placed the cubbies (setPlacements).
 */
import * as THREE from 'three';
import type { CubbiesClientMsg, CubbyInfo } from '../../../shared/protocol/cubbies';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import type { Collider, Interactable } from '../../world/types';
import { STATUS_TEXT, agentCard, clip, type CubbyIt, type CubbyPlacement } from './model';
import { CubbyRoom } from './room';
import { openAgentCard, openLeadChat, type CubbyWindows } from './ui-chat';
import { openJoin, openSetup, type SetupDialog } from './ui-setup';

export type { CubbyPlacement } from './model';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    cubbydoor: true;
    cubbylead: true;
    cubbycomputer: true;
    cubbyagent: true;
  }
}

export interface Cubbies {
  /**
   * Where the hall puts its cubbies (up to six, by slot), or null when this floor has no hall. The
   * cubbies are drawn, bumped into and used only once they're placed and the floor has them enabled.
   */
  setPlacements(places: readonly CubbyPlacement[] | null): void;
  /** Everything the cubbies draw, in the scene. */
  readonly group: THREE.Group;
  /** Each placed cubby, by slot (empty while disabled). */
  rooms(): ReadonlyMap<number, CubbyRoom>;
}

/** How long after asking to set a cubby up its token is still welcome without the setup window. */
const TOKEN_WAIT = 5 * 60_000;

export function installCubbies(ctx: Ctx): Cubbies {
  const group = new THREE.Group();
  group.name = 'cubbies';
  group.visible = false;
  ctx.scene.add(group);
  let places: readonly CubbyPlacement[] | null = null;
  const rooms = new Map<number, CubbyRoom>();
  let usables: Interactable[] = [];
  let added: { into: Collider[]; list: Collider[] } | null = null;
  let shown = false;

  const send = (m: CubbiesClientMsg) => ctx.net.send(m);
  const cubbyById = (id: string): CubbyInfo | undefined => store.cubbies.cubbies.find((c) => c.id === id);
  const windows: CubbyWindows = {
    cubby: cubbyById,
    onChange: (fn) => store.on('cubbies', fn),
    sendChat: (id, message) => send({ t: 'cubbies.chat', id, ...message }),
  };

  /** Whether the cubbies are there to see and use right now. */
  const active = () => store.cubbies.enabled && !!places && rooms.size > 0 && ctx.inOffice() && !ctx.upTop();

  function dropRooms() {
    for (const r of rooms.values()) {
      group.remove(r.group);
      r.dispose();
    }
    rooms.clear();
  }

  /** Builds the rooms for the placements while the floor has cubbies, and takes them down when it doesn't. */
  function rebuild() {
    const want = store.cubbies.enabled && places ? places : null;
    if (!want) dropRooms();
    else if (rooms.size !== want.length || want.some((p) => rooms.get(p.slot)?.place !== p)) {
      dropRooms();
      for (const p of want) {
        const r = new CubbyRoom(p);
        rooms.set(p.slot, r);
        group.add(r.group);
      }
    }
    sync();
  }

  function sync() {
    const bySlot = new Map(store.cubbies.cubbies.map((c) => [c.slot, c]));
    for (const r of rooms.values()) {
      const info = bySlot.get(r.place.slot);
      r.sync(info, info?.ownerName ?? '');
    }
    usables = [...rooms.values()].flatMap((r) => r.usables());
    refresh(true);
    ctx.hint.invalidate();
  }

  /** Shows or hides the cubbies, and puts what you bump into in the world you're in (or takes it out). */
  function refresh(force = false) {
    const on = active();
    if (on === shown && !force) return;
    shown = on;
    group.visible = on;
    if (added) {
      for (const c of added.list) {
        const i = added.into.indexOf(c);
        if (i >= 0) added.into.splice(i, 1);
      }
      added = null;
    }
    if (on) {
      const list = [...rooms.values()].flatMap((r) => r.colliders());
      const into = ctx.world().colliders;
      into.push(...list);
      added = { into, list };
    }
  }

  store.on('cubbies', rebuild);
  ctx.usables.add({ usable: () => (shown ? usables : []), pickable: () => group });
  ctx.ticks.add('others', (f) => {
    refresh();
    if (!shown) return;
    for (const r of rooms.values()) r.update(f.dt, f.t, Date.now());
  });

  // ---- Setting up -----------------------------------------------------------------------------------
  let setup: SetupDialog | null = null;
  let askedAt = -Infinity;
  ctx.messages.onAny((m) => {
    // Answers only the account that asked (see CubbiesServerMsg); never logged.
    const t = m as unknown as { t: string; id?: unknown; floorId?: unknown; token?: unknown };
    if (t.t !== 'cubbies.token' || typeof t.token !== 'string' || typeof t.floorId !== 'string' || t.floorId !== store.floor) return;
    const token = { token: t.token, floorId: t.floorId };
    if (setup?.open) setup.showToken(token);
    else if (performance.now() - askedAt < TOKEN_WAIT) openJoin(token);
    setup = null;
    askedAt = -Infinity;
  });

  const at = (it: Interactable) => it as CubbyIt;
  const roomOf = (it: Interactable) => rooms.get(at(it).slot);
  const mineOf = (it: Interactable) => {
    const c = at(it).cubbyId ? cubbyById(at(it).cubbyId!) : undefined;
    return c?.mine && c.interior ? { c, it: c.interior } : null;
  };
  const leadName = (x: { it: { leadName: string } } | null) => clip(x?.it.leadName ?? '', 20) || 'your lead';

  ctx.interactions.define('cubbydoor', {
    reach: 3,
    hint: (it) => {
      const info = roomOf(it)?.info;
      if (!info) {
        const can = store.cubbies.setupAllowed;
        return { k: `cubby-free-${can}`, parts: [hintTitle('✨ Free cubby'), can ? key('E', 'Set up') : aside('sign in to set up your cubby')] };
      }
      if (info.mine) {
        const where = info.interior ? `Runs on your ${clip(info.interior.computerName, 24)}` : 'waiting for your computer to join';
        return { k: `cubby-mine-${where}`, parts: [hintTitle('🚪 Your cubby'), aside(where), ...(info.lamp === 'asleep' ? [key('E', 'Set up')] : [])] };
      }
      const what = info.lamp === 'asleep' ? '💤 asleep' : `${Math.max(0, info.working | 0)} working · private`;
      return { k: `cubby-other-${info.ownerName}-${what}`, parts: [hintTitle(`🔒 ${clip(info.ownerName, 22)}`), aside(what)] };
    },
    use: (it, k) => {
      const info = roomOf(it)?.info;
      if (k !== 'E' || (info && (!info.mine || info.lamp !== 'asleep')) || !store.cubbies.setupAllowed || setup?.open) return;
      const slot = at(it).slot;
      setup = openSetup(slot, (leadName, look) => {
        askedAt = performance.now();
        send({ t: 'cubbies.setup', slot, leadName, look });
      });
    },
  });

  ctx.interactions.define('cubbylead', {
    reach: 3.5,
    hint: (it) => {
      const m = mineOf(it);
      const lead = leadName(m);
      const where = m?.c.lamp === 'asleep' ? `💤 ${clip(m.it.computerName, 24)} is asleep` : `Runs on your ${clip(m?.it.computerName ?? 'computer', 24)}`;
      return { k: `cubby-lead-${lead}-${where}`, parts: [hintTitle(`💬 ${lead}`), aside(where), key('E', `Talk to ${lead}`)] };
    },
    use: (it, k) => {
      if (k === 'E' && mineOf(it)) openLeadChat(windows, at(it).cubbyId!);
    },
  });

  ctx.interactions.define('cubbycomputer', {
    reach: 3,
    hint: (it) => {
      const m = mineOf(it);
      const state = m?.c.lamp === 'asleep' ? '💤 asleep' : m?.c.lamp === 'working' ? 'working' : 'online';
      return { k: `cubby-pc-${m?.it.computerName}-${state}`, parts: [hintTitle(`💻 ${clip(m?.it.computerName ?? 'Computer', 24)}`), aside(state), key('E', `Talk to ${leadName(m)}`)] };
    },
    use: (it, k) => {
      if (k === 'E' && mineOf(it)) openLeadChat(windows, at(it).cubbyId!);
    },
  });

  ctx.interactions.define('cubbyagent', {
    reach: 3.5,
    hint: (it) => {
      const m = mineOf(it);
      const a = m?.it.agents.find((x) => x.id === at(it).agentId);
      if (!a || !m) return { k: 'cubby-agent-gone', parts: [hintTitle('Helper'), aside('finished')] };
      const state = m.c.lamp === 'asleep' ? '💤 asleep' : a.role === 'direct' && a.status === 'working' ? 'busy' : STATUS_TEXT[a.status];
      const name = agentCard(a).name;
      return { k: `cubby-agent-${a.id}-${name}-${state}`, parts: [hintTitle(name), aside(state), key('E', a.role === 'direct' ? 'Tool and branch' : 'Task and progress')] };
    },
    use: (it, k) => {
      const id = at(it).agentId;
      if (k === 'E' && id && mineOf(it)) openAgentCard(windows, at(it).cubbyId!, id);
    },
  });

  return {
    setPlacements(p) {
      places = p && p.length ? p.slice(0, 6) : null;
      rebuild();
    },
    group,
    rooms: () => rooms,
  };
}
