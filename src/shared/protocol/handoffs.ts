// The engine swap (see docs/department-leads.md): an explicit handoff of a worker's task to a
// replacement worker on another engine, reviewed and acknowledged like every handoff. Never an
// in-place provider conversion.
import type { AgentEffort, AgentProvider } from './agents.js';

export interface HandoffBrief { brief: string; evidence: string; next: string }
export interface WorkerHandoff extends HandoffBrief {
  id: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  fromPath: string;
  fromBranch: string;
  toPath: string;
  toBranch: string;
  by: string;
  at: number;
  state: 'pending' | 'acknowledged' | 'delivery-failed';
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  /** Exact text reviewed before a single delivery; not an instruction to spawn another worker. */
  prompt: string;
}
export type HandoffClientMsg =
  | { t: 'handoff.prepare'; workerId: string; targetId: string; brief: HandoffBrief }
  | { t: 'handoff.cancel'; workerId: string; handoffId: string }
  | { t: 'handoff.ack'; workerId: string; handoffId: string }
  | { t: 'handoff.swap'; workerId: string; provider: AgentProvider; model?: string; effort?: AgentEffort; note?: string };
export type HandoffServerMsg = { t: 'handoff.preview'; workerId: string; handoff: WorkerHandoff };
