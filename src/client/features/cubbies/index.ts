/**
 * Cubbies: a private room per person, computer and floor, in the cubby hall west of the office's west
 * wall (hall.ts, which the office floor builds shut and this opens while the floor has cubbies). Each of
 * the hall's slots shows its owner's name, lamp and how many are working; yours has your computer, your
 * lead and every agent in the project's folder on it, and E talks to the lead or checks on a helper.
 * A free one sets up with E. Nothing here shows, collides or answers E while the floor has no hall
 * (store.cubbies.enabled) or the hall hasn't placed the cubbies (setPlacements).
 */
import * as THREE from 'three';
import type { CubbiesClientMsg, CubbyInfo } from '../../../shared/protocol/cubbies';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import { modalOpen } from '../../ui/dom';
import type { Collider, Interactable } from '../../world/types';
import { CUBBY_HALL, HALL_SLOTS, HALL_WAY_OUT, inCubbyHall } from '../../../shared/cubbyhall';
import { STATUS_TEXT, agentCard, clip, type CubbyIt, type CubbyPlacement } from './model';
import { CubbyRoom } from './room';
import { openAgentCard, openLeadChat, type CubbyWindows } from '../../shared/cubby/chat';
import { openJoin, openSetup, type SetupDialog } from './ui-setup';
import { knockAside, knockTitle, knockWaiting, watchingTitle } from './share-model';
import { wireSharing } from './sharing';

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
   * Puts the cubbies somewhere other than the hall's places (up to HALL_SLOTS, by slot), or back in the
   * hall (null). They're drawn, bumped into and used only while the floor has them enabled.
   */
  setPlacements(places: readonly CubbyPlacement[] | null): void;
  /** Everything the cubbies draw, in the scene. */
  readonly group: THREE.Group;
  /** Each placed cubby, by slot (empty while disabled). */
  rooms(): ReadonlyMap<number, CubbyRoom>;
  /** Opens the setup window for the cubby in `slot`, as E at a free cubby does (a draft's studio table uses it). */
  setUp(slot: number): void;
  /** Opens the chat with your cubby's lead, as E at the lead does. */
  talk(cubbyId: string): void;
}

/** How long after asking to set a cubby up its token is still welcome without the setup window. */
const TOKEN_WAIT = 5 * 60_000;

/** What the cubbies need from the rest of the page: what you're aiming at, for whose name tag shows. */
export interface CubbiesDeps { aimed: () => unknown }

export function installCubbies(ctx: Ctx, deps: CubbiesDeps = { aimed: () => null }): Cubbies {
  const group = new THREE.Group();
  group.name = 'cubbies';
  group.visible = false;
  ctx.scene.add(group);
  const hall = ctx.office.cubbyHall;
  let places: readonly CubbyPlacement[] = hall.places;
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
    sendOut: (id, accountId) => send({ t: 'cubbies.admit', id, accountId, allow: false }),
  };

  /** Whether the cubbies are there to see and use right now. */
  const active = () => store.cubbies.enabled && rooms.size > 0 && ctx.inOffice() && !ctx.upTop();

  function dropRooms() {
    for (const r of rooms.values()) {
      group.remove(r.group);
      r.dispose();
    }
    rooms.clear();
  }

  /** Builds the rooms for the placements while the floor has cubbies, and takes them down when it doesn't. */
  function rebuild() {
    openHall(store.cubbies.enabled);
    const want = store.cubbies.enabled ? places : null;
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
    share.beforeSync(store.cubbies.cubbies);
    const bySlot = new Map(store.cubbies.cubbies.map((c) => [c.slot, c]));
    for (const r of rooms.values()) {
      const info = bySlot.get(r.place.slot);
      r.sync(info, info?.ownerName ?? '');
    }
    usables = [...rooms.values()].flatMap((r) => r.usables());
    refresh(true);
    ctx.hint.invalidate();
  }

  /** Opens the hall, or walls it up again, sending anyone still in it out onto the open floor first. */
  function openHall(on: boolean) {
    if (on === hall.on) return;
    const p = ctx.player.pos;
    if (!on && ctx.inOffice() && !ctx.upTop() && p.y > -1 && inCubbyHall(p.x, p.z)) p.set(HALL_WAY_OUT.x, 0, HALL_WAY_OUT.z);
    hall.set(on);
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

  const share = wireSharing(ctx, { rooms: () => rooms, cubby: cubbyById, send, shown: () => shown });
  store.on('cubbies', rebuild);
  ctx.usables.add({ usable: () => (shown ? usables : []), pickable: () => group });
  ctx.ticks.add('others', (f) => {
    // The camera keeps inside the hall while you're in it (see Room.annex); the room's remade on each floor.
    ctx.player.room.annex = hall.on && ctx.inOffice() && !ctx.upTop() ? CUBBY_HALL : null;
    refresh();
    const p = ctx.player.pos;
    quietOutside(shown && inCubbyHall(p.x, p.z));
    if (!shown) return;
    const focus = { x: p.x, z: p.z, aimed: deps.aimed(), yaw: ctx.player.camYaw };

    for (const r of rooms.values()) r.update(f.dt, f.t, Date.now(), focus);
    // While a window (the chat, Send a task, setup) is open, the cubby's labels would show huge behind it.
    hideLabels(modalOpen());
  });

  // From inside the hall the office's floating labels (the board agents' speech cards above all) show
  // through the doorway and the windows and cover the cubbies, so while you're in it they're drawn on a
  // layer no camera looks at. Only on the way in and out, never every frame.
  let quieted: THREE.Object3D[] | null = null;
  function quietOutside(inHall: boolean) {
    if (inHall === !!quieted) return;
    if (quieted) {
      for (const o of quieted) o.layers.set(0);
      quieted = null;
      return;
    }
    quieted = [];
    const at = new THREE.Vector3();
    ctx.scene.traverse((o) => {
      if (!(o as THREE.Sprite).isSprite || !o.layers.isEnabled(0) || group === o || isInside(group, o)) return;
      o.getWorldPosition(at);
      if (at.x > CUBBY_HALL.maxX) {
        o.layers.set(OUTSIDE_LAYER);
        quieted!.push(o);
      }
    });
  }

  let hiddenLabels: THREE.Object3D[] = [];
  function hideLabels(hide: boolean) {
    for (const o of hiddenLabels) if (o.layers.isEnabled(MODAL_LAYER)) o.layers.set(0);
    hiddenLabels = [];
    if (!hide) return;
    group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && o.layers.isEnabled(0)) {
        o.layers.set(MODAL_LAYER);
        hiddenLabels.push(o);
      }
    });
  }

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

  function setUp(slot: number) {
    if (setup?.open) return;
    setup = openSetup(slot, (leadName, look) => {
      askedAt = performance.now();
      send({ t: 'cubbies.setup', slot, leadName, look });
    });
  }

  const at = (it: Interactable) => it as CubbyIt;
  const roomOf = (it: Interactable) => rooms.get(at(it).slot);
  /** Your own cubby's inside, or one you're watching. */
  const seenOf = (it: Interactable) => {
    const c = at(it).cubbyId ? cubbyById(at(it).cubbyId!) : undefined;
    return c?.interior && (c.mine || c.watching) ? { c, it: c.interior } : null;
  };
  /** In your own cubby, the hint adds Q. */
  const sendKey = () => (share.inOwn() ? [key('Q', 'Send a task to the floor')] : []);
  const qk = () => (share.inOwn() ? '-q' : '');
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
        return { k: `cubby-mine-${where}${qk()}`, parts: [hintTitle('🚪 Your cubby'), aside(where), ...(info.lamp === 'asleep' ? [key('E', 'Set up')] : []), ...sendKey()] };
      }
      if (info.watching) return { k: `cubby-watch-${info.ownerName}`, parts: [hintTitle(watchingTitle(info.ownerName)), key('E', 'Leave')] };
      const what = knockAside(info);
      const waiting = share.knocked(info.id);
      return {
        k: `cubby-other-${info.ownerName}-${what}-${waiting}`,
        parts: [hintTitle(knockTitle(info)), aside(what), waiting ? aside(knockWaiting(info.ownerName)) : key('E', 'Knock')],
      };
    },
    use: (it, k) => {
      const info = roomOf(it)?.info;
      if (k !== 'E') return;
      if (info && !info.mine) return info.watching ? share.leave(info) : share.knock(info);
      if ((info && info.lamp !== 'asleep') || !store.cubbies.setupAllowed) return;
      setUp(at(it).slot);
    },
  });

  ctx.interactions.define('cubbylead', {
    reach: 3.5,
    hint: (it) => {
      const m = seenOf(it);
      const lead = leadName(m);
      if (m && !m.c.mine) return { k: `cubby-lead-watch-${lead}-${m.c.ownerName}`, parts: [hintTitle(`💬 ${lead}`), aside(watchingTitle(m.c.ownerName)), key('E', 'Listen in')] };
      const where = m?.c.lamp === 'asleep' ? `💤 ${clip(m.it.computerName, 24)} is asleep` : `Runs on your ${clip(m?.it.computerName ?? 'computer', 24)}`;
      return { k: `cubby-lead-${lead}-${where}${qk()}`, parts: [hintTitle(`💬 ${lead}`), aside(where), key('E', `Talk to ${lead}`), ...sendKey()] };
    },
    use: (it, k) => {
      if (k === 'E' && seenOf(it)) openLeadChat(windows, at(it).cubbyId!);
    },
  });

  ctx.interactions.define('cubbycomputer', {
    reach: 3,
    hint: (it) => {
      const m = seenOf(it);
      const state = m?.c.lamp === 'asleep' ? '💤 asleep' : m?.c.lamp === 'working' ? 'working' : 'online';
      const act = m && !m.c.mine ? key('E', 'Listen in') : key('E', `Talk to ${leadName(m)}`);
      return { k: `cubby-pc-${m?.it.computerName}-${state}-${!!m?.c.mine}${qk()}`, parts: [hintTitle(`💻 ${clip(m?.it.computerName ?? 'Computer', 24)}`), aside(state), act, ...sendKey()] };
    },
    use: (it, k) => {
      if (k === 'E' && seenOf(it)) openLeadChat(windows, at(it).cubbyId!);
    },
  });

  ctx.interactions.define('cubbyagent', {
    reach: 3.5,
    hint: (it) => {
      const m = seenOf(it);
      const a = m?.it.agents.find((x) => x.id === at(it).agentId);
      if (!a || !m) return { k: 'cubby-agent-gone', parts: [hintTitle('Helper'), aside('finished')] };
      const state = m.c.lamp === 'asleep' ? '💤 asleep' : a.role === 'direct' && a.status === 'working' ? 'busy' : STATUS_TEXT[a.status];
      const name = agentCard(a).name;
      return { k: `cubby-agent-${a.id}-${name}-${state}${qk()}`, parts: [hintTitle(name), aside(state), key('E', a.role === 'direct' ? 'Tool and branch' : 'Task and progress'), ...sendKey()] };
    },
    use: (it, k) => {
      const id = at(it).agentId;
      if (k === 'E' && id && seenOf(it)) openAgentCard(windows, at(it).cubbyId!, id);
    },
  });

  return {
    setPlacements(p) {
      places = p && p.length ? p.slice(0, HALL_SLOTS) : hall.places;
      rebuild();
    },
    group,
    rooms: () => rooms,
    setUp,
    talk: (cubbyId) => openLeadChat(windows, cubbyId),
  };
}

/** The layer the office's labels are moved to while you're in the hall: no camera looks at it. */
const OUTSIDE_LAYER = 30;
function isInside(root: THREE.Object3D, o: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Where the cubby's labels go while a window is open: no camera looks at it. */
const MODAL_LAYER = 29;
