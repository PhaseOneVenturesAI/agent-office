// What the cubby hall shows, worked out from the store's state without three.js or the DOM, so the
// tests run it under node: where each agent goes in a cubby, what the sign and the lamp say, and the
// join command a cubby's computer runs.

import type { CubbyAgent, CubbyInfo, CubbyRole, CubbyStatus } from '../../../shared/protocol/cubbies';
import type { WorkerStatus } from '../../../shared/protocol';
import type { Collider, Interactable } from '../../world/types';
import { clip } from '../../shared/cubby/text';

// The words the hall, the cubby and the phone's My cubby share (no three.js there, for /lite).
export { ROLE_LABEL, STATUS_TEXT, agentCard, clip, deadlineText, helperName, leadColorIndex, toolName } from '../../shared/cubby/text';

/**
 * Where the hall puts one cubby: its slot (0–5), the middle of its floor, how wide (along its front) and
 * deep it is inside, and which way its front faces (`rotY`, 0 is +z, the office's way: the door is on
 * the +z side of its own frame). `front`: this module draws the glass front and its door (default on);
 * off when the hall builds its own.
 */
export interface CubbyPlacement {
  slot: number;
  x: number;
  z: number;
  y?: number;
  width: number;
  depth: number;
  rotY: number;
  front?: boolean;
}

/** How wide the doorway in a cubby's front is. */
export const DOOR_WIDTH = 1.1;
/** How tall the glass front is. */
export const FRONT_HEIGHT = 2.7;

export type CubbyFace = 'free' | 'mine' | 'watch' | 'other';

/** Whose cubby it is, as the hall sees it. A free slot has no cubby; one you're watching opens for you. */
export function faceOf(c: CubbyInfo | undefined): CubbyFace {
  return !c ? 'free' : c.mine ? 'mine' : c.watching && c.interior ? 'watch' : 'other';
}

export const LAMP_COLOR: Record<CubbyInfo['lamp'], string> = { online: '#06d6a0', working: '#ffd166', asleep: '#adb5bd' };

/** The dark pill over a cubby's door. Someone else's says only their name, the lamp and the count. */
export function signText(c: CubbyInfo | undefined): string {
  if (!c) return '✨ Free cubby';
  const name = clip(c.ownerName || 'Someone', 22);
  if (c.mine) return c.interior ? `${name} · ${clip(c.interior.computerName, 22)}` : `${name} · waiting for your computer`;
  if (c.watching && c.interior) return `👀 ${name} · ${clip(c.interior.computerName, 22)}`;
  return c.lamp === 'asleep' ? `🔒 ${name} · 💤 asleep` : `🔒 ${name} · ${Math.max(0, c.working | 0)} working`;
}

/** A cubby agent's status as a worker's light and card show it; every helper sleeps while the computer does. */
export function workerStatus(s: CubbyStatus, asleep: boolean): WorkerStatus {
  if (asleep) return 'offline';
  return s === 'working' ? 'working' : s === 'needs-you' ? 'needs_input' : s === 'idle' ? 'idle' : 'starting';
}

// ---- Where everyone goes inside -----------------------------------------------------------------------

export type SpotKind = 'seat' | 'reviewer' | 'machine' | 'screen' | 'stand' | 'bag';

/** Somewhere in a cubby, in its own frame (meters from its middle, the door at +z), facing `rotY`. */
export interface Spot {
  kind: SpotKind;
  index: number;
  x: number;
  z: number;
  rotY: number;
}

/**
 * The furniture's places, for a cubby `w` wide and `d` deep (the hall's are about 4.4 by 2.5): the
 * computer's desk and the builders' desk side by side against the back wall with the lead in front of
 * the computer, the factory machine and the reviewer's bean bag in the front corners either side of
 * the door, the Paradev screens on the left wall, and the standing spots and the overflow bean bags
 * (small ones) in the middle, each clear of the others (see tests/cubby-ui.test.ts).
 */
export function furniture(w: number, d: number) {
  const left = -w / 2;
  const right = w / 2;
  const back = -d / 2;
  const front = d / 2;
  const deskZ = back + 0.42;
  const boardW = Math.min(1.6, w / 2 - 0.25);
  return {
    computer: { x: left + 0.55, z: back + 0.35 },
    computerDesk: { width: 1.0, depth: 0.6 },
    lead: { x: left + 0.55, z: back + 1.1, rotY: 0 },
    builderDesk: { x: right - 0.92, z: deskZ },
    plan: { x: left + w / 4, y: 2.25, z: back + 0.04, width: boardW },
    needs: { x: right - w / 4, y: 2.25, z: back + 0.04, width: boardW },
    // Where builderDesk() puts its two chairs' workers: 0.78 out in front of the desk.
    seats: [-0.45, 0.45].map((dx, index): Spot => ({ kind: 'seat', index, x: right - 0.92 + dx, z: deskZ + 0.78, rotY: Math.PI })),
    reviewer: { kind: 'reviewer', index: 0, x: right - 0.52, z: front - 0.55, rotY: -Math.PI / 2 } satisfies Spot,
    machine: { kind: 'machine', index: 0, x: left + 0.32, z: front - 0.45, rotY: Math.PI / 2 } satisfies Spot,
    screens: [0, 1].map((index): Spot => ({ kind: 'screen', index, x: left + 0.06, z: back + 0.65 + index * 1.15, rotY: Math.PI / 2 })),
    stands: [-0.5, 0.15].map((x, index): Spot => ({ kind: 'stand', index, x, z: front - 0.87, rotY: 0 })),
    bags: [-0.5, 0.15].map((x, index): Spot => ({ kind: 'bag', index, x, z: front - 0.33, rotY: 0 })),
  };
}

/** How big each overflow bean bag is, against the reviewer's (they're small, the cubby is). */
export const OVERFLOW_BAG_SCALE = 0.6;

export interface Layout {
  /** Each agent drawn in the room, by id. */
  spots: Map<string, Spot>;
  /** Agents there's no room left for: still counted, and inspectable from the lead's window. */
  listed: string[];
}

/**
 * Puts each agent where its role goes: builders at the builders' desk (two seats, the harness's limit),
 * a reviewer on the bean bag, a factory run at the machine, a Paradev workspace on a wall screen, a
 * session you opened directly standing about. Whoever's left over gets an overflow bean bag while there
 * are any, the way the open floor brings them out. The lead is the room's own character, not a spot.
 */
export function layoutAgents(agents: readonly CubbyAgent[], w: number, d: number): Layout {
  const f = furniture(w, d);
  const free: Record<Exclude<SpotKind, 'bag'>, Spot[]> = { seat: [...f.seats], reviewer: [f.reviewer], machine: [f.machine], screen: [...f.screens], stand: [...f.stands] };
  const home: Record<Exclude<CubbyRole, 'lead'>, Exclude<SpotKind, 'bag'>> = { builder: 'seat', reviewer: 'reviewer', factory: 'machine', paradev: 'screen', direct: 'stand' };
  const bags = [...f.bags];
  const spots = new Map<string, Spot>();
  const listed: string[] = [];
  const over: CubbyAgent[] = [];
  for (const a of agents) {
    if (a.role === 'lead' || spots.has(a.id)) continue;
    const spot = free[home[a.role] ?? 'stand']?.shift();
    if (spot) spots.set(a.id, spot);
    else over.push(a);
  }
  for (const a of over) {
    const bag = bags.shift();
    if (bag) spots.set(a.id, bag);
    else listed.push(a.id);
  }
  return { spots, listed };
}

/** A key that changes whenever the room's layout would: who's there, in what role. */
export function layoutKey(agents: readonly CubbyAgent[]): string {
  return agents.map((a) => `${a.id}:${a.role}`).join('|');
}

/** (x, z) in a cubby's own frame, out on the floor. */
export function toFloor(p: CubbyPlacement, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  return { x: p.x + x * c + z * s, z: p.z - x * s + z * c };
}

/** Something to use in a cubby: which slot, which cubby, and which agent, if it's one. */
export interface CubbyIt extends Interactable {
  kind: 'cubbydoor' | 'cubbylead' | 'cubbycomputer' | 'cubbyagent';
  slot: number;
  cubbyId?: string;
  agentId?: string;
}

/** A box in a cubby's own frame (its middle, half sizes) as a collider out on the floor. */
export function colliderOf(p: CubbyPlacement, cx: number, cz: number, hw: number, hd: number, top: number): Collider {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [dx, dz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
    const q = toFloor(p, cx + dx, cz + dz);
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  const y = p.y ?? 0;
  return { minX, maxX, minZ, maxZ, top: y + top, ...(y ? { bottom: y } : {}) };
}

/** Something to use in a cubby, at (x, z) in its own frame. */
export function usableAt(p: CubbyPlacement, kind: CubbyIt['kind'], x: number, z: number, radius: number, extra: Partial<CubbyIt> = {}): CubbyIt {
  const q = toFloor(p, x, z);
  return { kind, x: q.x, z: q.z, ...(p.y ? { y: p.y } : {}), radius, slot: p.slot, ...extra };
}

// ---- Joining a computer -------------------------------------------------------------------------------

/** `s` quoted for a POSIX shell, unless it's plain enough not to need it. */
export function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export const PROJECT_PLACEHOLDER = '<local project path>';

/**
 * What the owner runs on their computer to bring a cubby to life: the Satellites join command with
 * cubbies on, for this floor, and the project folder they pick there (the office never learns it).
 */
export function joinCommand(o: { origin: string; token: string; floorId: string; project: string; cloudflare: boolean }): string {
  const project = o.project.trim();
  const where = project ? shellQuote(project) : `'${PROJECT_PLACEHOLDER}'`;
  return `agent-office join ${o.origin} --token ${shellQuote(o.token)} --cubbies --floor ${shellQuote(o.floorId)} --project ${where}${o.cloudflare ? ' --cloudflare-access' : ''}`;
}

/** A lead's name as setup sends it: trimmed, one line, at most 24 characters. */
export function cleanLeadName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 24);
}
