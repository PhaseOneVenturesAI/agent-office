// The cost wall (see server/costwall.ts): who is spending what, per person and per provider,
// from the workers at their desks right now, next to the office ledger's all-time and today.

import type { AgentProvider } from '../providers.js';
import type { Usage, UsageState } from './usage.js';

/** One person's spend on one provider: the workers on it and their session numbers added up. */
export interface CostwallCell {
  workers: number;
  usage: Usage;
  /** False when any of these workers runs a provider that reports tokens without pricing them. */
  costKnown: boolean;
}

/** One person's row: a cell per provider they run, plus everything added up. */
export interface CostwallRow {
  /** Who hired the workers (WorkerInfo.createdBy). */
  name: string;
  providers: Partial<Record<AgentProvider, CostwallCell>>;
  total: Usage;
  /** False when any of their workers can't price its tokens. */
  costKnown: boolean;
}

export interface CostwallState {
  /** Everyone with an agent at a desk, biggest known spend first. */
  rows: CostwallRow[];
  /** Every live agent added up. */
  office: Usage;
  /** False when any live agent's provider can't price its tokens. */
  costKnown: boolean;
  /** The office ledger: tracked spend all time and today, workers sent home included. */
  ledger: UsageState;
}

export type CostwallClientMsg =
  /** The wall, whenever the numbers move and when asked. */
  { t: 'costwall.get' };

export type CostwallServerMsg = { t: 'costwall'; state: CostwallState };
