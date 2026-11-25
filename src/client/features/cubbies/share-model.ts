// Sharing a cubby (cubbies step 4), worked out without three.js or the DOM so the tests run it under
// node: the words the knock, the owner's prompt and the answer use, whether you're standing inside a
// cubby, and what a task card sent to the floor may hold.

import type { CubbyInfo } from '../../../shared/protocol/cubbies';
import { clip } from '../../shared/cubby/text';
import type { CubbyPlacement } from './model';

/** How long a knock waits for its answer before the door's hint offers to knock again. */
export const KNOCK_WAIT_MS = 60_000;

/** A task card's title and prompt, at most (the queue's own limits). */
export const TASK_TITLE_MAX = 120;
export const TASK_PROMPT_MAX = 4000;
/** What the Send a task panel says it does. */
export const TASK_NOTE = "Runs on the office server, in this floor's public Task queue. Your computer's work stays put.";

const who = (name: string) => clip(name, 22) || 'Someone';

/** At someone else's frosted door: their name, and how many are working (or asleep). */
export function knockTitle(info: Pick<CubbyInfo, 'ownerName'>): string {
  return `🔒 ${who(info.ownerName)}`;
}
export function knockAside(info: Pick<CubbyInfo, 'lamp' | 'working'>): string {
  return info.lamp === 'asleep' ? '💤 asleep' : `${Math.max(0, info.working | 0)} working`;
}
/** The hint while your knock waits. */
export function knockWaiting(ownerName: string): string {
  return `Knocked, waiting for ${who(ownerName)}…`;
}
/** The owner's prompt. */
export function knockPrompt(name: string): string {
  return `${who(name)} knocked on your cubby: let them watch and listen?`;
}
/** What the knocker hears back. */
export function answerText(ownerName: string, allow: boolean): string {
  return allow ? `🚪 ${who(ownerName)} let you in` : `🚪 ${who(ownerName)} is busy`;
}
/** The hint inside a cubby you're watching. */
export function watchingTitle(ownerName: string): string {
  return `👀 Watching ${who(ownerName)}'s cubby`;
}

/** Whether a knock sent at `at` is still waiting at `now`. */
export function knockPending(at: number | undefined, now: number): boolean {
  return at !== undefined && now - at < KNOCK_WAIT_MS;
}

/** Whether (x, z) on the floor is inside the cubby at `p` (its doorway's threshold counts as inside). */
export function insideCubby(p: CubbyPlacement, x: number, z: number, threshold = 0.25): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  // Back into the cubby's own frame (the inverse of toFloor).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < p.width / 2 && lz > -p.depth / 2 && lz < p.depth / 2 + threshold;
}

/** Just outside a cubby's door, on the floor: where someone sent out of it is put. */
export function outsideDoor(p: CubbyPlacement): { x: number; z: number } {
  const lz = p.depth / 2 + 0.9;
  return { x: p.x + lz * Math.sin(p.rotY), z: p.z + lz * Math.cos(p.rotY) };
}

/** A task card as it goes to the floor: trimmed, within the limits, or null while there's no title or prompt. */
export function cleanTask(title: string, prompt: string): { title: string; prompt: string } | null {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, TASK_TITLE_MAX);
  const p = prompt.trim().slice(0, TASK_PROMPT_MAX);
  return t && p ? { title: t, prompt: p } : null;
}

/** The toast once the card's on the queue. */
export function taskSentText(title: string): string {
  return `📋 "${clip(title, 60)}" is on this floor's Task queue`;
}
