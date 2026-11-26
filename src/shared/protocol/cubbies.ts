import type { OwnerColor } from '../personal-agents/appearance.js';
import type { Look } from '../avatar.js';

/** Only explicit owner chat crosses inward; no terminal, command or approval frames. */
export type CubbyRole = 'lead' | 'builder' | 'reviewer' | 'factory' | 'paradev' | 'direct';
export type CubbyStatus = 'idle' | 'working' | 'needs-you' | 'unknown';
export interface CubbyAgent {
  id: string;
  tool: string;
  department?: string;
  harnessRole?: string;
  leadTitle?: string;
  role: CubbyRole;
  task: string;
  branch: string;
  status: CubbyStatus;
  progress?: string;
  deadlineAt?: number;
  /** A screen-drawing helper (harness role designer): on a draft floor each one uncovers a pod. */
  designer?: boolean;
}
export interface CubbyChatLine { id: string; role: 'user' | 'assistant' | 'notice'; text: string; at: number }
export interface CubbyInterior {
  computerName: string;
  computerId?: string;
  /** Owner only: the devices the computer trusts to talk to its lead (public fingerprints and names only). */
  ownerDevices?: CubbyDevice[];
  /** Owner only: devices asking to be trusted, each with the code it shows on its own screen. */
  deviceRequests?: CubbyDeviceRequest[];
  leadName: string;
  look: Look;
  agents: CubbyAgent[];
  plan: string[];
  needsYou: string[];
  chat: CubbyChatLine[];
  observedAt?: number;
  error?: string;
}
export interface CubbyInfo {
  hqLead?: import('./hq.js').HQLeadAway;
  id: string;
  slot: number;
  ownerName: string;
  ownerColor?: OwnerColor;
  mine: boolean;
  lamp: 'online' | 'working' | 'asleep';
  working: number;
  /**
   * Never present for another account, including admins, except a watcher the owner let in
   * (cubbies step 4), who gets it read-only: no chat sending, no approvals.
   */
  interior?: CubbyInterior;
  /** You're watching this cubby: the owner let you in after you knocked. */
  watching?: true;
  /** Owner only: who's watching now, and who's knocking. */
  watchers?: CubbyPerson[];
  knocking?: CubbyPerson[];
}
/** Someone at a cubby's door or inside it as a watcher: their account and display name. */
export interface CubbyPerson { accountId: string; name: string }
/** One device the cubby's computer trusts: its key's fingerprint (32 hex), the name it asked with and when it was added. */
export interface CubbyDevice { fingerprint: string; label: string; addedAt: number }
/**
 * A device asking to be trusted, with its public key. The approving device works the code out from that
 * key itself (deviceCode), so it matches what the asking device shows only if nobody swapped the key on
 * the way, and its signature names that exact key.
 */
export interface CubbyDeviceRequest { requestId: string; label: string; publicKey: string; at: number }
/** Most devices one cubby trusts, and most waiting to be approved. */
export const MAX_OWNER_DEVICES = 8;
export const MAX_DEVICE_REQUESTS = 4;
export interface CubbiesState { ownerColor?: OwnerColor; enabled: boolean; floorId?: string; cubbies: CubbyInfo[]; setupAllowed: boolean }
export type CubbiesClientMsg =
  | { t: 'cubbies.get' }
  | { t: 'cubbies.setup'; slot: number; leadName: string; look: Look; ownerColor?: OwnerColor }
  | ({ t: 'cubbies.chat'; id: string } & CubbyOwnerMessage)
  /** From a device that isn't trusted yet: asks the computer to trust its public key. */
  | { t: 'cubbies.addDevice'; id: string; publicKey: string; label: string }
  /** From a trusted device: approve or deny a waiting device, or remove a trusted one (signed by that trusted device). */
  | ({ t: 'cubbies.device'; id: string } & CubbyDeviceAction)
  /** E at someone else's door: ask to watch and listen (cubbies step 4). */
  | { t: 'cubbies.knock'; id: string }
  /** The owner answers a knock (allow) or sends a watcher out (allow false). */
  | { t: 'cubbies.admit'; id: string; accountId: string; allow: boolean }
  /** A watcher leaves. */
  | { t: 'cubbies.leave'; id: string }
  /** Q in your own cubby: a task card for the floor's public Task queue, run by office-server agents. */
  | { t: 'cubbies.sendTask'; id: string; title: string; prompt: string };
export type CubbiesServerMsg =
  | { t: 'cubbies'; state: CubbiesState }
  | { t: 'cubbies.token'; id: string; floorId: string; token: string }
  /** To the owner: someone knocked. */
  | { t: 'cubbies.knocked'; id: string; by: CubbyPerson }
  /** To the knocker: the owner's answer. */
  | { t: 'cubbies.answer'; id: string; allow: boolean }
  /** To the owner: your task card is on the floor's queue. */
  | { t: 'cubbies.taskSent'; id: string; title: string };

/** Bound to one authenticated satellite and a locally chosen project folder. */
export type CubbyNodeFrame =
  | { t: 'cubby.hello'; floorId: string; computerId: string; computerName: string }
  /** The devices the computer trusts now and the ones waiting; `note` says what just changed. */
  | { t: 'cubby.devices'; floorId: string; devices: CubbyDevice[]; requests: CubbyDeviceRequest[]; note?: string }
  | { t: 'cubby.snapshot'; floorId: string; agents: CubbyAgent[]; plan: string[]; needsYou: string[]; observedAt: number; error?: string; wake?: string;
      /** On a draft floor: what the local `.agent-office/draft.json` says (see protocol/drafts.ts). */
      projects?: import('./hq.js').HQProject[]; draft?: import('./drafts.js').DraftBoards; pitch?: import('./pitch.js').Pitch }
  | { t: 'cubby.reply'; floorId: string; requestId: string; text: string; error?: boolean }
  /**
   * One piece of a cleaned board image (step 5): `data` is base64, pieces arrive in order, and the office
   * keeps the image only when the pieces add up to `hash` (SHA-256 hex) and the bytes are the `mime` they claim.
   */
  | { t: 'cubby.design-image'; floorId: string; hash: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; index: number; total: number; data: string };
export interface CubbyBinding { cubbyId: string; floorId: string; ownerId: string; connectionId: string; computerId: string }
export type CubbyRelayFrame =
  | ({ t: 'cubby.verdict'; signature: string } & CubbyBinding & import('./pitch.js').PitchVerdictMessage)
  | ({ t: 'cubby.ready'; signature: string } & CubbyBinding)
  | ({ t: 'cubby.chat'; signature: string } & CubbyBinding & CubbyOwnerMessage)
  | ({ t: 'cubby.device-request'; signature: string; requestId: string; at: number; publicKey: string; label: string } & CubbyBinding)
  | ({ t: 'cubby.device'; signature: string } & CubbyBinding & CubbyDeviceAction)
  /** The owner's note on a board card (step 5), checked against the trusted devices like chat. */
  | ({ t: 'cubby.feedback'; signature: string } & CubbyBinding & import('./drafts.js').DraftFeedbackMessage);

/**
 * What a trusted device signs to change who's trusted. `target` is the waiting device's public key for
 * add and deny, or a trusted device's fingerprint for revoke.
 */
export interface CubbyDeviceAction { action: 'add' | 'deny' | 'revoke'; target: string; requestId: string; at: number; ownerSig: string }
export type CubbyDevicePayload = Pick<CubbyBinding, 'cubbyId' | 'floorId' | 'computerId'> & Omit<CubbyDeviceAction, 'ownerSig'>;
export function ownerDeviceEncoding(f: CubbyDevicePayload): string {
  return JSON.stringify(['agent-office/cubby-owner-device/v1', f.cubbyId, f.floorId, f.computerId, f.requestId, f.at, f.action, f.target]);
}
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/**
 * The code a device shows for its key: the first 80 bits of SHA-256 over its public key (SPKI), as 16
 * Crockford base32 characters in four groups ("7QK2 M9XD 4TFA H3PZ"). 80 bits so that a server that
 * swaps in its own key can't search for one whose code matches the real device's (a six-digit code
 * falls to a million tries).
 */
export function deviceCode(digest: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 16; i++) {
    const bit = i * 5, byte = bit >> 3, shift = bit & 7;
    const word = (digest[byte] << 8) | (digest[byte + 1] ?? 0);
    out += CODE_ALPHABET[(word >> (11 - shift)) & 31];
  }
  return out.match(/.{4}/g)!.join(' ');
}
/** A typed code, as deviceCode writes it: spaces and dashes dropped, case and look-alikes (O, I, L) folded. */
export function normalizeDeviceCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export interface CubbyOwnerMessage { text: string; requestId: string; at: number; ownerSig: string }
export type CubbyOwnerPayload = Pick<CubbyBinding, 'cubbyId' | 'floorId' | 'computerId'> & Omit<CubbyOwnerMessage, 'ownerSig'>;
/** Versioned, domain-separated UTF-8 JSON tuple; text is never trimmed or normalized in transit. */
export function ownerChatEncoding(f: CubbyOwnerPayload): string {
  return JSON.stringify(['agent-office/cubby-owner-chat/v1', f.cubbyId, f.floorId, f.computerId, f.requestId, f.at, f.text]);
}
