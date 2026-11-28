import type { OwnerColor } from '../personal-agents/appearance.js';
import type { Look } from '../avatar.js';

/** Only explicit owner chat crosses inward; no terminal, command or approval frames. */
export type CubbyRole = 'lead' | 'builder' | 'reviewer' | 'factory' | 'paradev' | 'direct';
export type CubbyStatus = 'idle' | 'working' | 'needs-you' | 'unknown';
export interface CubbyAgent {
  kind?: 'worker' | 'factory';
  lastTool?: string;
  updatedAt?: number;
  id: string;
  tool: string;
  department?: string;
  harnessRole?: string;
  lead?: string;
  startedAt?: number;
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
  hqLead?: import('./hq.js').HQLeadPresence;
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
export interface CubbiesState { ownerColor?: OwnerColor; enabled: boolean; floorId?: string; cubbies: CubbyInfo[]; setupAllowed: boolean }
export type CubbiesClientMsg =
  | { t: 'cubbies.get' }
  | { t: 'cubbies.setup'; slot: number; leadName: string; look: Look; ownerColor?: OwnerColor }
  | ({ t: 'cubbies.chat'; id: string } & CubbyOwnerMessage)
  /** Retired requests receive a migration notice. */
  | { t: 'cubbies.addDevice'; id: string; publicKey: string; label: string }
  | { t: 'cubbies.device'; id: string }
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
export type CubbyRelayFrame = { t: 'cubby.ready'; signature: string } & CubbyBinding;
/** Retired chat fields are accepted only to return a migration notice. */
export interface CubbyOwnerMessage { text: string; requestId: string; at: number }
