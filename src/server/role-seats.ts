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

/** Copy history before moving the authoritative seat. Keep the source record for recovery. */
export function relinkRoleSeat(_ctx: FloorContext, floor: Floor, fromId: string, toId: string): string | undefined {
  const ceo = floor.ceo.get()?.workerId === fromId;
  const manager = floor.departments.leadDeptOfWorker(fromId);
  if (!ceo && !manager) return; // Ordinary personal-worker swaps have no role history to migrate.
  if (!floor.roleChat.migrate(fromId, toId, true)) return 'Could not copy the role conversation. The original seat is unchanged; retry the pending swap.';
  const error = ceo ? floor.ceo.relinkWorker(fromId, toId) : floor.departments.relinkWorker(fromId, toId);
  return error ? `Could not save the replacement role: ${error}. The source history is retained; retry the pending swap.` : undefined;
}
