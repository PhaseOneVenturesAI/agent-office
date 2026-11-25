// The devices a cubby's computer trusts to talk to its lead (several, since 2026-11-25: Jonathan wanted
// every device he's signed in on to be able to send, not just read). The trust lives on this computer
// only, in the project's cubby state (0600), and the office never decides it:
// - the first device is pinned here at join (--owner-key), as before;
// - a new device makes its own non-extractable key and asks; the computer keeps the request and shows
//   a 16-character code (80 bits) worked out from that key, which the new device shows on its own screen too;
// - one of the trusted devices approves it with its own signature (or the owner runs
//   `agent-office cubby devices approve <code>` here). A server that swaps in its own key can't make the
//   codes match, and it can't sign an approval, so it can't add a device;
// - any trusted device (or the command here) can remove one, never the last.
// Files are re-read on every use, so the command's changes count at once in a running connector.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_DEVICE_REQUESTS, MAX_OWNER_DEVICES, type CubbyDevice, type CubbyDeviceRequest, type CubbyNodeFrame } from '../../../shared/protocol/cubbies.js';
import { ownerDeviceCode, ownerFingerprint, ownerPublicKey } from '../wire.js';
import { clean, jsonFile } from './io.js';
import { withDeviceLock } from './device-lock.js';

/** A trusted device: its public key and how it's shown. */
export interface Pin { key: string; fingerprint: string; label: string; addedAt: number }
/** A device asking to be trusted. */
export interface Waiting { requestId: string; key: string; label: string; code: string; at: number }
interface DeviceState { pins: Pin[]; waiting: Waiting[] }
export interface DeviceStore {
  pins(): Pin[]; waiting(): Waiting[];
  /** Reads and edits fresh state under the shared lock; only changed lists are written. */
  update<T>(edit: (state: DeviceState) => T): T;
}

/** How long a request waits for approval. */
export const WAIT_MS = 10 * 60_000;

export const pinOf = (key: string, label: string, addedAt: number): Pin => ({ key, fingerprint: ownerFingerprint(key), label: clean(label, 40) || 'Device', addedAt });
const floorHash = (floor: string) => createHash('sha256').update(floor).digest('hex');
export const pinFile = (state: string, floor: string) => path.join(state, `owner-${floorHash(floor)}.json`);
const waitFile = (state: string, floor: string) => path.join(state, `devices-waiting-${floorHash(floor)}.json`);

function put(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(temp, file); }
  finally { try { unlinkSync(temp); } catch { /* renamed, or never made */ } }
}

/** The trusted devices pinned for `floor`, reading the older one-key record too. Throws on a damaged record. */
export function readPins(state: string, floor: string): Pin[] | undefined {
  const file = pinFile(state, floor);
  if (!existsSync(file)) return undefined;
  const record = jsonFile(file);
  if (record?.floor !== floor) throw new Error('Invalid local owner key record');
  const list: unknown[] = Array.isArray(record.devices) ? record.devices : typeof record.ownerKey === 'string' ? [{ key: record.ownerKey, label: 'First device', addedAt: 0 }] : [];
  const pins = list.map((d: any) => {
    ownerPublicKey(d?.key);
    return pinOf(d.key, typeof d.label === 'string' ? d.label : 'Device', Number.isSafeInteger(d.addedAt) ? d.addedAt : 0);
  });
  if (!pins.length || pins.length > MAX_OWNER_DEVICES) throw new Error('Invalid local owner key record');
  return pins;
}
function putPins(state: string, floor: string, pins: Pin[]) {
  put(pinFile(state, floor), { floor, devices: pins.map(({ key, label, addedAt }) => ({ key, label, addedAt, fingerprint: ownerFingerprint(key).match(/.{4}/g)!.join('-') })) });
}
export function updatePins(state: string, floor: string, edit: (pins: Pin[] | undefined) => Pin[] | undefined) {
  withDeviceLock(pinFile(state, floor), () => {
    const pins = readPins(state, floor), next = edit(pins);
    if (next && next !== pins) putPins(state, floor, next);
  });
}
export function writePins(state: string, floor: string, pins: Pin[]) {
  updatePins(state, floor, () => pins);
}

/** The project's files, re-read on every use; with no pin record yet, the key given at join. */
export function fileStore(state: string, floor: string, joinKey: string): DeviceStore {
  const read = {
    pins: () => readPins(state, floor) ?? [pinOf(joinKey, 'First device', 0)],
    waiting: () => {
      const file = waitFile(state, floor);
      if (!existsSync(file)) return [];
      try {
        const list = jsonFile(file);
        return Array.isArray(list) ? list.filter((w: any) => typeof w?.key === 'string' && typeof w.requestId === 'string').slice(0, MAX_DEVICE_REQUESTS) : [];
      } catch { return []; }
    },
  };
  return { ...read, update(edit) {
    return withDeviceLock(pinFile(state, floor), () => {
      const current = { pins: read.pins(), waiting: read.waiting() };
      const beforePins = JSON.stringify(current.pins), beforeWaiting = JSON.stringify(current.waiting);
      const result = edit(current);
      if (JSON.stringify(current.pins) !== beforePins) putPins(state, floor, current.pins);
      if (JSON.stringify(current.waiting) !== beforeWaiting) put(waitFile(state, floor), current.waiting);
      return result;
    });
  } };
}
export function memoryStore(pins: Pin[], waiting: Waiting[] = []): DeviceStore {
  return { pins: () => structuredClone(pins), waiting: () => structuredClone(waiting), update(edit) {
    const current = structuredClone({ pins, waiting }), result = edit(current);
    pins = current.pins; waiting = current.waiting; return result;
  } };
}

const fresh = (waiting: Waiting[], now: number) => waiting.filter((w) => now - w.at < WAIT_MS && w.at - now < 60_000);

/** A new device asks to be trusted. Returns what changed, for the owner's chat, or nothing. */
export function ask(store: DeviceStore, r: { requestId: string; key: string; label: string }, now: number): string | undefined {
  ownerPublicKey(r.key);
  return store.update((state) => {
    const pins = state.pins;
    let waiting = fresh(state.waiting, now);
    if (pins.some((p) => p.key === r.key)) return;
    waiting = waiting.filter((w) => w.key !== r.key);
    if (waiting.length >= MAX_DEVICE_REQUESTS) waiting.shift();
    const label = clean(r.label, 40) || 'Device';
    waiting.push({ requestId: r.requestId, key: r.key, label, code: ownerDeviceCode(r.key), at: now });
    state.waiting = waiting;
    return `📱 ${label} asks to talk to your lead. Its code is ${ownerDeviceCode(r.key)}: approve it only on a device you already use, and only if that device shows the same code.`;
  });
}

/** A signed change (verified under the lock), or a change the owner made on this computer. */
export function change(store: DeviceStore, action: 'add' | 'deny' | 'revoke', target: string, now: number, authorized?: (key: string) => boolean): { note?: string; error?: string } {
  return store.update((state) => {
    const pins = state.pins;
    if (authorized && !pins.some(p => authorized(p.key))) return { error: 'That change wasn’t signed by a device this computer trusts, so nothing changed.' };
    const waiting = fresh(state.waiting, now);
    if (action === 'revoke') {
      const gone = pins.find((p) => p.fingerprint === target);
      if (!gone) return { error: 'That device isn’t trusted any more.' };
      if (pins.length === 1) return { error: 'That’s the only device that can talk to your lead, so it stays. Add another one first.' };
      state.pins = pins.filter((p) => p !== gone); state.waiting = waiting;
      return { note: `🔒 ${gone.label} can’t talk to your lead any more.` };
    }
    const asked = waiting.find((w) => w.key === target);
    if (!asked) return { error: 'That request has expired. Ask again from the new device.' };
    const rest = waiting.filter((w) => w !== asked);
    if (action === 'deny') { state.waiting = rest; return { note: `🚫 Didn’t add ${asked.label}.` }; }
    if (pins.length >= MAX_OWNER_DEVICES) return { error: `A cubby trusts at most ${MAX_OWNER_DEVICES} devices. Remove one first.` };
    state.pins = [...pins, pinOf(asked.key, asked.label, now)]; state.waiting = rest;
    return { note: `✅ ${asked.label} can talk to your lead now.` };
  });
}

/** What the office shows the owner: fingerprints, names and codes only, never a key. */
export function devicesFrame(store: DeviceStore, floor: string, now: number, note?: string): Extract<CubbyNodeFrame, { t: 'cubby.devices' }> {
  const devices: CubbyDevice[] = store.pins().map(({ fingerprint, label, addedAt }) => ({ fingerprint, label, addedAt }));
  const requests: CubbyDeviceRequest[] = fresh(store.waiting(), now).map(({ requestId, label, key, at }) => ({ requestId, label, publicKey: key, at }));
  return { t: 'cubby.devices', floorId: floor, devices, requests, ...(note ? { note: note.slice(0, 400) } : {}) };
}

/** The floors this project's computer has pinned devices for (for the local command). */
export function pinnedFloors(state: string): string[] {
  if (!existsSync(state)) return [];
  return readdirSync(state).filter((f) => /^owner-[0-9a-f]{64}\.json$/.test(f)).flatMap((f) => {
    try { const floor = jsonFile(path.join(state, f))?.floor; return typeof floor === 'string' ? [floor] : []; } catch { return []; }
  });
}
