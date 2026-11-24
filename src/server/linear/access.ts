import type { Ctx } from '../office/context.js';
import { accountEmail, canEditManager, ceoOwner } from '../role-access.js';
import type { LinearControlScope } from './service.js';
/** Business task authority is project/department scoped, independent of who connected OAuth.
 * Missing departments/leads do not invoke canEditManager's administrator bootstrap behavior. */
export function canControlLinear(ctx: Ctx, accountId: string, scope: LinearControlScope): boolean {
  const floor = ctx.floors.get(scope.floorId), email = accountEmail(ctx, accountId);
  if (!floor || !email) return false;
  if (scope.taskId) {
    const task = floor.queue.state().tasks.find((t) => t.id === scope.taskId);
    if (!task?.linear || task.linear.departmentId !== scope.departmentId) return false;
  }
  const owner = ceoOwner(floor);
  if (owner && email === owner) return true;
  if (!scope.departmentId || !floor.departments.get(scope.departmentId)?.lead) return false;
  return canEditManager(ctx, floor, scope.departmentId, accountId).ok;
}
