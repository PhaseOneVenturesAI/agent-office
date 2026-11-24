import { builtDesks } from '../../../shared/layout.js';
import type { RolePresence, RolePresenceClientMsg } from '../../../shared/protocol.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';
import { RoleHomes } from '../../role-homes.js';
import { canEditCeo, canEditManager, roleAccessForManager } from '../../role-access.js';
import { canUseRoleWorker, managerExecution, staffQaExecution } from '../../role-subscriptions/access.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

const homes = new WeakMap<Floor, RoleHomes>();
/** Recipient-specific action hints. Every actual action still goes through its original guard. */
export function rolePresence(ctx: Ctx, floor: Floor, account: string | undefined): { roles: RolePresence[]; error?: string } {
  const ceo = floor.ceo.get();
  const roles = [
    ...(ceo ? [{ key: 'ceo', name: ceo.name, title: 'CEO', workerId: ceo.workerId, department: undefined, desks: [] as string[] }] : []),
    ...floor.departments.state().departments.filter(d => d.lead).map(d => ({ key: `manager:${d.id}`, name: d.lead!.name, title: `${d.name} manager`, workerId: d.lead!.workerId, department: d.id, desks: d.desks })),
  ];
  let saved = homes.get(floor);
  if (!saved) { saved = new RoleHomes(floor.dataDir); homes.set(floor, saved); }
  const resolved = saved.resolve(roles.map(r => ({ ...r, workerDesk: r.workerId ? floor.workers.get(r.workerId)?.deskId : undefined })), builtDesks(floor.plan.wing).map(d => d.id), id => floor.workers.deskOccupied(id));
  // A furniture-record failure must not remove access to an existing private role conversation.
  const error = typeof resolved === 'string' ? resolved : undefined;
  return { ...(error ? { error } : {}), roles: roles.map(r => {
    const worker = r.workerId ? floor.workers.get(r.workerId) : undefined;
    const edit = r.department ? canEditManager(ctx, floor, r.department, account) : canEditCeo(ctx, floor, account);
    const audience = r.department ? roleAccessForManager(ctx, floor, r.department, account) : undefined;
    const custody = edit.ok && worker ? canUseRoleWorker(ctx, account, floor, worker.id) : false;
    const launchError = !worker && edit.ok && r.department ? managerExecution(ctx, floor, r.department, account).error : undefined;
    const ask = !!r.department && audience?.kind !== 'none';
    const askError = ask ? staffQaExecution(ctx, floor, r.department!, account).error : undefined;
    const reason = !edit.ok && !ask ? (r.department ? 'Questions are limited to this manager’s audience.' : 'The CEO is private to its owner.')
      : worker && edit.ok && !custody ? 'Subscription access is required to open this conversation.' : launchError ?? askError;
    const deskId = typeof resolved === 'string' ? worker?.deskId ?? '' : resolved[r.key];
    return { key: r.key, name: r.name, title: r.title, ...(r.department ? { department: r.department } : {}), deskId, ...(worker ? { workerId: worker.id } : {}), talk: edit.ok && custody, start: !worker && edit.ok && !launchError, ask, ...(reason ? { reason } : {}) };
  }) };
}
export const rolePresenceHandlers = {
  'role.presence.get'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor || typeof msg.requestId !== 'string' || msg.requestId.length > 80) return;
    ctx.sendTo(c, { t: 'role.presence', requestId: msg.requestId, floor: floor.id, ...rolePresence(ctx, floor, c.accountId) });
  },
} satisfies HandlerMap<RolePresenceClientMsg>;
