import type { RoleSubscriptionClientMsg } from '../../shared/protocol.js';
import { here } from '../ws/handlers/common.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
import { subscriptionScope } from './access.js';
function state(ctx: Ctx, c: Client, department: string, allow?: boolean, configuration?: string, allowStaffQA = false) {
  const floor = here(ctx, c);
  if (!floor || typeof department !== 'string') return;
  let scope = subscriptionScope(ctx, floor, department);
  if (!scope.d?.lead) return ctx.warn(c, 'Name the manager first.');
  const own = !!c.accountId && scope.custodian?.id === c.accountId;
  let error: string | undefined;
  if (allow !== undefined) {
    if (!own) error = 'Only the named custodian may grant or revoke their own subscription.';
    else if (configuration !== scope.configuration) error = 'The department, provider or controller list changed. Review the updated scope before consenting.';
    else if (allow && (!scope.personal || scope.controllers.some(id => !id))) error = 'Connect your own provider sign-in and make sure every named controller has an Office account first.';
    else error = allow
      ? ctx.roleSubscriptions.set({ floor: floor.id, department, provider: scope.engine, custodian: c.accountId!, controllers: scope.controllers as string[], configuration: scope.configuration, allowStaffQA, allowWorkers: true, at: Date.now() })
      : ctx.roleSubscriptions.revoke(floor.id, department);
    scope = subscriptionScope(ctx, floor, department);
  }
  ctx.sendTo(c, { t: 'role.subscription.state', error, state: {
    floor: floor.id, department, project: floor.def.name, departmentName: scope.d!.name,
    provider: scope.engine, custodian: scope.d!.lead?.custodian,
    controllers: scope.emails, active: scope.active, canConsent: own, configuration: scope.configuration, audience: scope.audience, allowStaffQA: scope.active && scope.grant?.allowStaffQA === true, allowWorkers: scope.active && scope.grant?.allowWorkers === true,
    reason: scope.active ? undefined : !scope.custodian ? 'Name a custodian with an Office account.' : !scope.personal ? 'Custodian must connect their own provider sign-in.' : 'Custodian consent pending.',
  } });
  if (allow !== undefined && !error) for (const other of ctx.clients?.values() ?? []) {
    if (other !== c && !other.out && ctx.floorOf(other) === floor) state(ctx, other, department);
  }
}
export const roleSubscriptionHandlers = {
  'role.subscription.get': (ctx, c, msg) => state(ctx, c, msg.department),
  'role.subscription.set': (ctx, c, msg) => {
    if (typeof msg.allow !== 'boolean') return ctx.warn(c, 'Choose allow or revoke.');
    state(ctx, c, msg.department, msg.allow, msg.configuration, msg.allowStaffQA === true);
  },
} satisfies HandlerMap<RoleSubscriptionClientMsg>;
