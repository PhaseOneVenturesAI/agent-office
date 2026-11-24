import { canUseRoleWorker } from './role-subscriptions/access.js';
import { canAccessRoleWorker } from './role-access.js';
import type { AgentProvider, WorkerInfo } from '../shared/protocol.js';
import type { Ctx } from './office/context.js';
import { providerAdapter } from './providers/index.js';

/** Credential ownership applies to controls and private transcripts, not public task status. */
export function canUseWorker(ctx: Ctx, accountId: string | undefined, owner: string | undefined, provider?: AgentProvider): boolean {
  if (owner) {
    return accountId === owner && !(['claude', 'kimi', 'codex', 'github'] as const).some((which) => ctx.signins.officeRevoked(owner, which));
  }
  if (!accountId) return true; // Shared-password workers keep their existing behavior.
  const which = providerAdapter(provider)?.signIn;
  return !!which && ctx.signins.officeAllowed(accountId, which);
}

export const OWN_WORKER = 'Use your own agent. Ask its owner to continue this task; office credentials need an explicit host-owner grant.';

/** Only Claude/Kimi/Codex currently support personal provider credentials. */
export function personalProviderError(owner: string | undefined, kind: string, provider: AgentProvider | undefined): string | undefined {
  if (owner && kind === 'agent' && !providerAdapter(provider)?.signIn) return `${provider} has no personal sign-in support in Office yet. Choose Claude, Kimi or Codex and sign in with your own account.`;
}

export function publicWorker(ctx: Ctx, worker: WorkerInfo): WorkerInfo {
  return { ...worker, ownerName: worker.owner ? ctx.accounts.get(worker.owner)?.name ?? 'Former account' : 'Office' };
}

export function canViewTerminal(ctx: Ctx, accountId: string | undefined, workerId: string): boolean {
  const floor = ctx.workerFloor(workerId);
  const worker = floor?.workers.get(workerId);
  return !!worker && !!floor && canAccessRoleWorker(ctx, floor, workerId, accountId) && canUseRoleWorker(ctx, accountId, floor, workerId);
}
