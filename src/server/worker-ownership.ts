import type { AgentProvider, WorkerInfo } from '../shared/protocol.js';
import { DESK_BY_ID } from '../shared/layout.js';
import type { Ctx } from './office/context.js';
import { providerAdapter } from './providers/index.js';

/** Whether the account runs the office (a shared-password guest does too); admins see and open every worker. */
export function isOfficeAdmin(ctx: Ctx, accountId: string | undefined): boolean {
  return !accountId || ctx.accounts.get(accountId)?.role === 'admin';
}

/**
 * Who may open a worker's terminal and type into it: the account that hired it, the coworkers it is
 * shared with (WorkerInfo.sharedWith), and the admins. Named accounts never acquire another account's
 * or the host's credentials through a worker.
 */
export function canUseWorker(ctx: Ctx, accountId: string | undefined, owner: string | undefined, _provider?: AgentProvider, sharedWith?: string[]): boolean {
  if (accountId === owner) return true;
  if (isOfficeAdmin(ctx, accountId)) return true;
  return !!accountId && !!sharedWith?.includes(accountId);
}

/** Who may manage a worker — send it home, resume it, change who it's shared with: its owner and the admins, not the coworkers it's shared with. */
export function canManageWorker(ctx: Ctx, accountId: string | undefined, owner: string | undefined): boolean {
  return accountId === owner || isOfficeAdmin(ctx, accountId);
}

/**
 * Who a worker shows up for at all (its card, its updates, its screens): a desk worker is private to
 * those who may use it, while the meeting room's table and the board agents at their kiosks are the
 * floor's own and stay visible to everyone on it.
 */
export function canSeeWorker(ctx: Ctx, accountId: string | undefined, info: WorkerInfo, owner: string | undefined): boolean {
  if (info.meeting || DESK_BY_ID.get(info.deskId)?.station) return true;
  return canUseWorker(ctx, accountId, owner, info.provider, info.sharedWith);
}

/** The coworkers a hire or a queued task is shared with, from what a browser sent: known accounts, never the owner, at most a floor's worth. */
export function sanitizeSharedWith(ctx: Ctx, accountId: string | undefined, value: unknown): string[] | undefined {
  if (!accountId || !Array.isArray(value)) return undefined;
  const ids = [...new Set(value.map((x) => (typeof x === 'string' ? x.slice(0, 64) : '')))].filter((id) => id && id !== accountId && !!ctx.accounts.get(id)).slice(0, 50);
  return ids.length ? ids : undefined;
}

export const OWN_WORKER = 'Use an agent you hired with your own sign-ins. Ask this agent’s owner to continue its task.';

export function personalProviderError(owner: string | undefined, kind: string, provider: AgentProvider | undefined): string | undefined {
  if (owner && kind === 'agent' && !providerAdapter(provider)?.signIn) return `${provider} has no personal sign-in support in Office yet. Choose Claude, Kimi or Codex and sign in under ☰ → 🔐 Your sign-ins.`;
}

/** Resolve the stored credential owner, never the editable character name or createdBy label. */
export function publicWorker(ctx: Ctx, worker: WorkerInfo, owner?: string): WorkerInfo {
  return { ...worker, owner, ownerName: owner ? ctx.accounts.get(owner)?.name ?? 'Former account' : 'Office' };
}

export function canViewTerminal(ctx: Ctx, accountId: string | undefined, workerId: string): boolean {
  const floor = ctx.workerFloor(workerId);
  const worker = floor?.workers.get(workerId);
  return !!worker && canUseWorker(ctx, accountId, floor?.workers.ownerOf(workerId), worker.provider, worker.sharedWith);
}
