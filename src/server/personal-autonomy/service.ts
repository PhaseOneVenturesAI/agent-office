import type { PersonalAutonomyState, PersonalAutonomyWorker, WorkerInfo } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { confirmedAutonomy, type AutonomyMode } from '../providers/autonomy.js';
import { accountEmail, ceoOwner, roleOrigin } from '../role-access.js';
import { subscriptionScope } from '../role-subscriptions/access.js';

/** Only personal credential ownership is relevant; admin/controller status cannot select coworkers. */
export function personalWorkerScope(ctx: Ctx, floor: Floor, worker: WorkerInfo, account: string): { explicit?: AutonomyMode; why?: string } | undefined {
  if (worker.kind !== 'agent' || floor.workers.ownerOf(worker.id) !== account) return;
  const provider = worker.provider;
  if (provider !== 'claude' && provider !== 'codex' && provider !== 'kimi') return { why: 'This provider has no verified automatic mode.' };
  if (ctx.signins.state(account)[provider].how === 'office') return { why: 'This agent uses an office sign-in. Your personal default does not apply.' };
  const origin = roleOrigin(floor, worker.id);
  if (origin?.kind === 'unavailable') return { why: 'Role ownership needs repair before changing this session.' };
  if (origin?.kind === 'ceo') {
    const role = floor.ceo.get();
    if (role?.workerId !== worker.id || ceoOwner(floor) !== accountEmail(ctx, account)) return { why: 'This role is no longer your active CEO. Its session was kept.' };
    return { explicit: confirmedAutonomy(role) };
  }
  const queued = floor.queue.state().tasks.find(t => t.workerId === worker.id && t.parentId && t.dept);
  const parentOwner = queued?.parentId ? floor.workers.ownerOf(queued.parentId) : undefined;
  // Match queue admission: a human launching on their own account remains a personal worker.
  const custodiedChild = queued && (!parentOwner || queued.owner === parentOwner);
  const department = origin?.kind === 'manager' ? origin.department : custodiedChild ? queued.dept : undefined;
  if (department) {
    const scope = subscriptionScope(ctx, floor, department, provider);
    if (!scope.active || scope.custodian?.id !== account || (queued && !scope.grant?.allowWorkers)) return { why: 'Current custodian consent is required. This session was kept.' };
    if (origin?.kind === 'manager') {
      if (scope.d?.lead?.workerId !== worker.id) return { why: 'This is a retired role worker. Its session was kept.' };
      return { explicit: confirmedAutonomy(scope.d.lead) };
    }
  }
  return {};
}

export function personalAutonomyState(ctx: Ctx, account: string): PersonalAutonomyState {
  const saved = ctx.personalAutonomy.get(account), defaultMode = ctx.personalAutonomy.mode(account);
  const workers: PersonalAutonomyWorker[] = [];
  for (const floor of ctx.floors.values()) for (const worker of floor.workers.list()) {
    const scope = personalWorkerScope(ctx, floor, worker, account); if (!scope) continue;
    const requested = scope.explicit ?? defaultMode ?? worker.autonomyRequested;
    const row: PersonalAutonomyWorker = { id: worker.id, name: worker.name, floor: floor.project.name, provider: worker.provider ?? 'unknown', requested, status: 'pending', detail: 'Saved for the next launch; active work is kept.', roleOverride: scope.explicit !== undefined, pendingApproval: floor.workers.autonomyDetails(worker.id).pendingApproval };
    if (scope.why) { row.status = 'unavailable'; row.detail = scope.why; }
    else if (scope.explicit && defaultMode && scope.explicit !== defaultMode) { row.status = 'override'; row.detail = `Explicit role setting: ${scope.explicit === 'autonomous' ? 'automatic' : 'manual'}. Your default does not replace it.`; }
    else if (worker.autonomyError) { row.detail = worker.autonomyError; }
    else if (requested && (worker.status === 'offline' || worker.status === 'exited')) { row.detail = 'Saved for the next launch. This agent has no active process.'; }
    else if (requested && worker.autonomyApplied?.mode === requested) {
      row.status = worker.autonomyApplied.acknowledged ? 'applied' : 'launch'; row.detail = worker.autonomyApplied.detail;
    } else if (!requested) { row.status = 'unavailable'; row.detail = 'Using its existing provider settings. No personal default saved yet.'; }
    workers.push(row);
  }
  return { configured: !!saved, automatic: saved?.automatic ?? false, updatedAt: saved?.at, workers };
}

export async function applyPersonalAutonomy(ctx: Ctx, account: string, mode: AutonomyMode): Promise<string[]> {
  const changes: Promise<string | undefined>[] = [];
  for (const floor of ctx.floors.values()) for (const worker of floor.workers.list()) {
    const scope = personalWorkerScope(ctx, floor, worker, account);
    if (!scope || scope.why || (scope.explicit && scope.explicit !== mode)) continue;
    changes.push(floor.workers.applyAutonomy(worker.id, mode, scope.explicit ? 'explicit' : 'account'));
  }
  return (await Promise.all(changes)).filter((x): x is string => !!x);
}
