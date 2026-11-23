// Role seats (see docs/department-leads.md): who speaks for a role, and the swap handover. Kept
// apart from floor.ts so the floor stays under the size budget; Floor delegates here.

import type { FloorContext } from './floor.js';
import type { Floor } from './floor.js';
import type { Department } from '../shared/protocol.js';
import type { CeoIdentity } from '../shared/protocol.js';
import type { RoleChat } from './role-chat.js';

/** What floor.ts provides: the seats this module operates on. */
export interface RoleSeatFloor {
  workers: { get(id: string): { name: string } | undefined };
  departments: { get(id: string): Department | undefined; leadDeptOfWorker(workerId: string): Department | undefined; relinkWorker(fromId: string, toId: string): void };
  ceo: { get(): CeoIdentity | undefined; relinkWorker(fromId: string, toId: string): void };
  roleChat: RoleChat;
}

/** A worker speaking for a role (the CEO or a department manager): protected from send-home. */
export function isRoleWorkerOn(floor: RoleSeatFloor, workerId: string): { role: string; name: string } | undefined {
  if (floor.ceo.get()?.workerId === workerId) return { role: 'CEO', name: floor.ceo.get()!.name };
  const dept = floor.departments.leadDeptOfWorker(workerId);
  if (dept?.lead) return { role: `${dept.name} manager`, name: dept.lead.name };
  return undefined;
}

/**
 * After a landed swap: the durable record moves FIRST, transactionally; only when it has landed do
 * the manager and CEO identities and the roster follow. A failed migration leaves the source
 * identity and its history exactly as they were.
 */
export function relinkRoleSeat(ctx: FloorContext, floor: Floor, fromId: string, toId: string): void {
  if (!floor.roleChat.migrate(fromId, toId)) {
    ctx.toast(floor, `Couldn't move ${floor.workers.get(fromId)?.name ?? 'their'} conversation record to the replacement — the swap keeps its old seat; try again.`, 'warn');
    return;
  }
  floor.departments.relinkWorker(fromId, toId);
  floor.ceo.relinkWorker(fromId, toId);
}
