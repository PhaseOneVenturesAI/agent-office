import type { AgentProvider, WorkerInfo } from '../../shared/protocol.js';
import type { AutonomyMode } from '../providers/autonomy.js';
import type { RunAs, Worker, WorkerContext } from './types.js';

export function autonomyChoice(explicit: AutonomyMode | undefined, kind: string, owner: string | undefined, provider: AgentProvider | undefined, runAs?: RunAs): Pick<WorkerInfo, 'autonomyRequested' | 'autonomySource'> {
  const preference = kind === 'agent' && owner && provider ? runAs?.autonomy?.(owner, provider) : undefined;
  return { autonomyRequested: explicit ?? preference, autonomySource: explicit ? 'explicit' : preference ? 'account' : undefined };
}
export function refreshPersonalAutonomy(info: WorkerInfo, owner: string | undefined, runAs?: RunAs): void {
  if (info.autonomySource === 'explicit' || (info.autonomySource !== 'account' && info.autonomyRequested !== undefined)) return;
  const choice = autonomyChoice(undefined, info.kind, owner, info.provider, runAs);
  if (choice.autonomyRequested !== undefined) Object.assign(info, choice);
  else if (info.autonomySource === 'account') {
    delete info.autonomyRequested; delete info.autonomySource; delete info.autonomyError;
    // This runs before a new process starts; its previous launch is no longer runtime evidence.
    delete info.autonomyApplied;
  }
}
export function queueWorkerAutonomy(w: Worker | undefined, persist: () => boolean, emit: (w: Worker) => void, mode: AutonomyMode, source: 'account' | 'explicit' = 'explicit'): string | undefined {
  if (!w) return 'The preference was saved; its worker is no longer seated.';
  const before = { autonomyRequested: w.info.autonomyRequested, autonomySource: w.info.autonomySource, autonomyError: w.info.autonomyError };
  Object.assign(w.info, { autonomyRequested: mode, autonomySource: source, autonomyError: undefined });
  if (!persist()) { Object.assign(w.info, before); return 'Worker permission settings could not be saved. Retry before restarting.'; }
  emit(w);
}
/** Saves first. Live Kimi changes need native capability and an ACK; other processes are retained. */
export async function applyWorkerAutonomy(ctx: Pick<WorkerContext, 'workers' | 'emit'> & { persist(): boolean }, id: string, mode: AutonomyMode, source: 'account' | 'explicit' = 'account'): Promise<string | undefined> {
  const w = ctx.workers.get(id);
  const error = queueWorkerAutonomy(w, ctx.persist, ctx.emit, mode, source);
  if (error || !w) return error;
  const session = w.dsh;
  if (w.info.provider !== 'kimi' || !session || !('setAutonomy' in session)) return;
  const outcome = await session.setAutonomy(mode);
  if (w.dsh !== session || ctx.workers.get(id) !== w || w.info.autonomyRequested !== mode) return;
  w.info.autonomyError = outcome.applied ? undefined : outcome.detail;
  if (!ctx.persist()) { w.info.autonomyError = 'The native mode changed, but its status could not be saved.'; ctx.emit(w); return w.info.autonomyError; }
  ctx.emit(w);
  return outcome.applied ? undefined : outcome.detail;
}
