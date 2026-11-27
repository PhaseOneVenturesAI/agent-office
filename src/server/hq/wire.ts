import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HQProject } from '../../shared/protocol/hq.js';
import type { CubbyAgent } from '../../shared/protocol/cubbies.js';
import type { Pitch } from '../../shared/protocol/pitch.js';
export interface MacProject { project: HQProject; agents: CubbyAgent[]; pitch?: Pitch; draft?: import('../../shared/protocol/drafts.js').DraftBoards }
export interface MacSnapshot { t: 'hq.snapshot'; computerId: string; observedAt: number; projects: MacProject[] }
export interface MacReady { t: 'hq.ready'; computerId: string; owner: string; floor: string; connection: string; signature: string }
export function macSignature(key: string, f: Omit<MacReady, 'signature'>) {
  return createHmac('sha256', key).update(JSON.stringify([f.t, f.computerId, f.owner, f.floor, f.connection])).digest('hex');
}
export function verifyMac(key: string, f: MacReady) {
  return typeof f.signature === 'string' && /^[a-f0-9]{64}$/.test(f.signature) &&
    timingSafeEqual(Buffer.from(f.signature, 'hex'), Buffer.from(macSignature(key, f), 'hex'));
}
/** The node transport's existing frame limit. Leave room for JSON/UTF-8 overhead. */
export const MAC_BYTES = 60 * 1024;
