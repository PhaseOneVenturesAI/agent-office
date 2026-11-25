import type { Look } from '../avatar.js';

/** Only explicit owner chat crosses inward; no terminal, command or approval frames. */
export type CubbyRole = 'lead' | 'builder' | 'reviewer' | 'factory' | 'paradev' | 'direct';
export type CubbyStatus = 'idle' | 'working' | 'needs-you' | 'unknown';
export interface CubbyAgent {
  id: string;
  tool: string;
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
  ownerFingerprint?: string;
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
  id: string;
  slot: number;
  ownerName: string;
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
export interface CubbiesState { enabled: boolean; floorId?: string; cubbies: CubbyInfo[]; setupAllowed: boolean }
export type CubbiesClientMsg =
  | { t: 'cubbies.get' }
  | { t: 'cubbies.setup'; slot: number; leadName: string; look: Look }
  | ({ t: 'cubbies.chat'; id: string } & CubbyOwnerMessage)
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
  | { t: 'cubby.owner-key'; floorId: string; fingerprint: string }
  | { t: 'cubby.snapshot'; floorId: string; agents: CubbyAgent[]; plan: string[]; needsYou: string[]; observedAt: number; error?: string; wake?: string;
      /** On a draft floor: what the local `.agent-office/draft.json` says (see protocol/drafts.ts). */
      draft?: import('./drafts.js').DraftBoards }
  | { t: 'cubby.reply'; floorId: string; requestId: string; text: string; error?: boolean };
export interface CubbyBinding { cubbyId: string; floorId: string; ownerId: string; connectionId: string; computerId: string }
export type CubbyRelayFrame =
  | ({ t: 'cubby.ready'; signature: string } & CubbyBinding)
  | ({ t: 'cubby.chat'; signature: string } & CubbyBinding & CubbyOwnerMessage);

export interface CubbyOwnerMessage { text: string; requestId: string; at: number; ownerSig: string }
export type CubbyOwnerPayload = Pick<CubbyBinding, 'cubbyId' | 'floorId' | 'computerId'> & Omit<CubbyOwnerMessage, 'ownerSig'>;
/** Versioned, domain-separated UTF-8 JSON tuple; text is never trimmed or normalized in transit. */
export function ownerChatEncoding(f: CubbyOwnerPayload): string {
  return JSON.stringify(['agent-office/cubby-owner-chat/v1', f.cubbyId, f.floorId, f.computerId, f.requestId, f.at, f.text]);
}
