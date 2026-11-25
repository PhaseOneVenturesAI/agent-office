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
}
export interface CubbyChatLine { id: string; role: 'user' | 'assistant' | 'notice'; text: string; at: number }
export interface CubbyInterior {
  computerName: string;
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
  /** Never present for another account, including admins. */
  interior?: CubbyInterior;
}
export interface CubbiesState { enabled: boolean; floorId?: string; cubbies: CubbyInfo[]; setupAllowed: boolean }
export type CubbiesClientMsg =
  | { t: 'cubbies.get' }
  | { t: 'cubbies.setup'; slot: number; leadName: string; look: Look }
  | { t: 'cubbies.chat'; id: string; text: string };
export type CubbiesServerMsg =
  | { t: 'cubbies'; state: CubbiesState }
  | { t: 'cubbies.token'; id: string; floorId: string; token: string };

/** Bound to one authenticated satellite and a locally chosen project folder. */
export type CubbyNodeFrame =
  | { t: 'cubby.hello'; floorId: string; computerId: string; computerName: string }
  | { t: 'cubby.snapshot'; floorId: string; agents: CubbyAgent[]; plan: string[]; needsYou: string[]; observedAt: number; error?: string; wake?: string }
  | { t: 'cubby.reply'; floorId: string; requestId: string; text: string; error?: boolean };
export interface CubbyBinding { cubbyId: string; floorId: string; ownerId: string; connectionId: string }
export type CubbyRelayFrame =
  | ({ t: 'cubby.ready'; signature: string } & CubbyBinding)
  | ({ t: 'cubby.chat'; requestId: string; at: number; text: string; signature: string } & CubbyBinding);
