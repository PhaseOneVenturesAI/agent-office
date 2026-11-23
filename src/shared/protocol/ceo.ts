// The floor's CEO (see docs/department-leads.md): one persistent identity per project that the
// person talks to and that directs the department managers, who delegate the actual workers. No
// cross-floor CEO: the identity lives in this floor's own .agent-office/ceo.json, and every
// assignment and report stays on this floor.

import type { AgentEffort, AgentProvider } from './agents.js';
import type { DeptPreset } from './departments.js';

export interface CeoIdentity {
  /** e.g. "Avery". */
  name: string;
  /** The live worker speaking for the CEO, while their shift runs. */
  workerId?: string;
  /** The engine the CEO last ran on; the next launch offers it as the saved default. */
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  by: string;
  at: number;
}

export interface CeoState {
  /** A failed load disables mutations rather than replacing retained data. */
  error?: string;
  ceo?: CeoIdentity;
}

export type CeoClientMsg =
  /** Name (or replace) the CEO identity and its saved engine. Never launches. */
  | { t: 'ceo.set'; name: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Take the CEO identity away (a live CEO worker keeps its desk as a normal worker). */
  | { t: 'ceo.clear' }
  /** Start the CEO's shift explicitly: seats their worker at a desk with the CEO prompt. */
  | { t: 'ceo.launch'; prompt?: string; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  /** Assign a scoped objective to one of the floor's managers; `execute` starts an off-shift manager. */
  | { t: 'ceo.assign'; dept: DeptPreset; objective: string; execute?: boolean };

export type CeoServerMsg = { t: 'ceo'; state: CeoState };
