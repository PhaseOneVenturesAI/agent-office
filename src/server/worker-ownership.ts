import type { AgentProvider, WorkerInfo } from '../shared/protocol.js';
import type { Ctx } from './office/context.js';
import { providerAdapter } from './providers/index.js';

/** Named accounts never acquire another account's or the host's credentials through a worker. */
export function canUseWorker(_ctx: Ctx, accountId: string | undefined, owner: string | undefined, _provider?: AgentProvider): boolean {
  return accountId === owner;
}

export const OWN_WORKER = 'Use an agent you hired with your own sign-ins. Ask this agent’s owner to continue its task.';

export function personalProviderError(owner: string | undefined, kind: string, provider: AgentProvider | undefined): string | undefined {
  if (owner && kind === 'agent' && !providerAdapter(provider)?.signIn) return `${provider} has no personal sign-in support in Office yet. Choose Claude, Kimi or Codex and sign in under ☰ → 🔐 Your sign-ins.`;
}

/** Resolve the stored credential owner, never the editable character name or createdBy label. */
export function publicWorker(ctx: Ctx, worker: WorkerInfo, owner?: string): WorkerInfo {
  return { ...worker, ownerName: owner ? ctx.accounts.get(owner)?.name ?? 'Former account' : 'Office' };
}

export function canViewTerminal(ctx: Ctx, accountId: string | undefined, workerId: string): boolean {
  const floor = ctx.workerFloor(workerId);
  const worker = floor?.workers.get(workerId);
  return !!worker && canUseWorker(ctx, accountId, floor?.workers.ownerOf(workerId), worker.provider);
}
