import type { AgentProvider } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import { ceoOwner, roleAccessForManager, roleOrigin } from '../role-access.js';
import { canUseWorker } from '../worker-ownership.js';
import { providerAdapter } from '../providers/index.js';

export function subscriptionScope(ctx: Ctx, floor: Floor, department: string, provider?: AgentProvider) {
  const d = floor.departments.get(department), lead = d?.lead;
  const engine = provider ?? d?.policy?.provider ?? lead?.provider ?? floor.workers.officeDefault.provider;
  const emails = [...new Set([...(lead?.controllers ?? []), ...(ceoOwner(floor) ? [ceoOwner(floor)!] : [])].map(e => e.toLowerCase()))].sort();
  const custodian = lead?.custodian ? ctx.accounts.byEmail(lead.custodian) : undefined;
  const controllers = emails.map(email => ctx.accounts.byEmail(email)?.id);
  const audience = [...new Set((lead?.audience ?? []).map(e => e.toLowerCase()))].sort();
  const configuration = JSON.stringify([floor.id, department, engine, custodian?.id ?? '', emails, controllers, audience]);
  const which = providerAdapter(engine)?.signIn;
  const personal = !!custodian && !!which && ctx.signins.ready(custodian.id, which) && ctx.signins.state(custodian.id)[which].how !== 'office' && !ctx.signins.officeRevoked(custodian.id, which);
  const grant = ctx.roleSubscriptions?.get(floor.id, department);
  const active = !!lead && !!custodian && personal && controllers.every(Boolean) && grant?.configuration === configuration && grant.custodian === custodian.id && grant.provider === engine;
  return { d, engine, emails, controllers, audience, custodian, configuration, personal, active, grant };
}
export function managerExecution(ctx: Ctx, floor: Floor, department: string, actor: string | undefined, provider?: AgentProvider): { owner?: string; error?: string } {
  if (!ctx.accounts.any) return { owner: actor };
  const access = roleAccessForManager(ctx, floor, department, actor);
  if (access.kind !== 'owner' && access.kind !== 'controller') return { error: 'Only this department’s controllers or project owner may start manager work.' };
  const scope = subscriptionScope(ctx, floor, department, provider);
  if (!scope.active || !actor || !scope.grant?.controllers.includes(actor)) return { error: 'Subscription consent pending. Ask the named custodian to approve this department and its controllers in Roles.' };
  return { owner: scope.custodian!.id };
}
/** Personal workers and private CEOs retain their existing credential rules. */
export function canUseRoleWorker(ctx: Ctx, account: string | undefined, floor: Floor, workerId: string): boolean {
  const worker = floor.workers.get(workerId), owner = floor.workers.ownerOf(workerId);
  if (!worker) return false;
  if (canUseWorker(ctx, account, owner, worker.provider)) return true;
  if (!ctx.roleSubscriptions) return false;
  const origin = roleOrigin(floor, workerId);
  const pending = floor.departments.state?.().departments.find(d => d.lead?.workerId && floor.workers.get(d.lead.workerId)?.swap?.replacementId === workerId);
  const department = origin?.kind === 'manager' && floor.departments.get(origin.department)?.lead?.workerId === workerId ? origin.department : pending?.id;
  if (!department) return false;
  const allowed = managerExecution(ctx, floor, department, account, worker.provider);
  return !allowed.error && !!owner && allowed.owner === owner;
}
/** Automatic notices may not restart spending after consent was revoked. */
export function roleDispatchError(ctx: Ctx, floor: Floor, workerId: string): string | undefined {
  if (!ctx.accounts.any) return;
  const d = floor.departments.leadDeptOfWorker(workerId);
  if (!d?.lead) return;
  if (!d.lead.custodian) return 'Manager subscription consent is pending; designate its custodian in Roles.';
  const worker = floor.workers.get(workerId), scope = subscriptionScope(ctx, floor, d.id, worker?.provider);
  if (!scope.active || scope.custodian?.id !== floor.workers.ownerOf(workerId)) return 'Manager subscription consent is pending or revoked; the notice remains held.';
}

/** Staff spending is a separate explicit consent; manager controller grants alone never cover Q&A. */
export function staffQaExecution(ctx: Ctx, floor: Floor, department: string, actor: string | undefined): { owner?: string; error?: string } {
  if (!ctx.accounts.any) return {};
  if (roleAccessForManager(ctx, floor, department, actor).kind === 'none') return { error: 'You are not in this manager’s Q&A audience.' };
  const email = floor.departments.get(department)?.lead?.custodian;
  if (!email) return { error: 'Set a billing custodian for this manager in Roles first.' };
  if (!ctx.accounts.byEmail(email)) return { error: `The custodian ${email} isn’t an account on this office.` };
  const scope = subscriptionScope(ctx, floor, department);
  if (!scope.active || scope.grant?.allowStaffQA !== true) return { error: 'Read-only Q&A subscription consent is pending. Ask the named custodian to enable staff Q&A for this audience in Roles.' };
  return { owner: scope.custodian!.id };
}

/** New child spending is opt-in, same department/provider, and checked again when queued work seats. */
export function departmentWorkerError(ctx: Ctx, floor: Floor, managerId: string, provider?: AgentProvider): string | undefined {
  if (!ctx.accounts.any) return;
  const origin = roleOrigin(floor, managerId);
  if (origin?.kind !== 'manager') return;
  const d = floor.departments.get(origin.department);
  if (!d?.lead?.custodian) return 'Designate a custodian and approve department-worker spending in Roles first.';
  const worker = floor.workers.get(managerId), scope = subscriptionScope(ctx, floor, origin.department, provider ?? floor.workers.officeDefault.provider);
  if (!scope.active || !scope.grant?.allowWorkers || scope.custodian?.id !== floor.workers.ownerOf(managerId) || worker?.provider !== scope.engine)
    return 'Department-worker subscription consent is pending or revoked for this provider. Ask the custodian in Roles, or have a controller launch a personal worker.';
}
export function queuedDepartmentError(ctx: Ctx, floor: Floor, task: import('../../shared/protocol.js').QueueTask): string | undefined {
  if (!ctx.accounts.any || !task.parentId || !task.dept) return;
  const parentOwner = floor.workers.ownerOf(task.parentId);
  if (parentOwner && task.owner !== parentOwner) return; // A human’s own explicitly queued worker stays personal.
  const scope = subscriptionScope(ctx, floor, task.dept, task.provider);
  if (!scope.active || !scope.grant?.allowWorkers || scope.custodian?.id !== task.owner) return 'Queued department work needs current custodian consent for this provider.';
}
