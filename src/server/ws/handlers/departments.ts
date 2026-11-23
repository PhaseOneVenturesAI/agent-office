// Departments: the floor's corners of work (see server/departments.ts). Everything but launch is
// paperwork on the floor's store; launch goes through the same spawn as every hire, after the
// department composed the worker's prompt.
import { roomDeskIds } from '../../../shared/department-rooms.js';
import { nextFreeSeat } from '../../../shared/layout.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type DepartmentsClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const departmentsView: ViewPieces['departments'] = (_ctx, floor) => floor?.departments.state() ?? { departments: [], sources: [] };

export const departmentsHandlers = {
  'departments.add'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.departments.add(msg.preset, msg.name, who);
    if (typeof r === 'string') ctx.warn(c, r);
    else ctx.toastFloor(floor, `🏬 ${who} opened a ${r.name} department on this floor`);
  },
  'departments.remove'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const err = floor.departments.remove(str(msg.id, 16), (id) => !!floor.workers.get(id));
    if (err) ctx.warn(c, err);
  },
  'departments.brief'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const err = floor.departments.brief(str(msg.id, 16), str(msg.text, 25000), typeof msg.base === 'number' ? msg.base : -1, who);
    if (err) ctx.warn(c, err);
  },
  'departments.brief.history'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.departments.briefHistory(str(msg.id, 16), msg.before);
    if (typeof r === 'string') return ctx.warn(c, r);
    ctx.sendTo(c, { t: 'departments.brief.history', id: str(msg.id, 16), revs: r.revs, archived: r.archived, next: r.next });
  },
  'departments.asset'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const err = floor.departments.addAsset(str(msg.id, 16), msg, c.peer.name);
    if (err) ctx.warn(c, err);
  },
  'departments.asset.drop'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const err = floor.departments.dropAsset(str(msg.id, 16), str(msg.asset, 16));
    if (err) ctx.warn(c, err);
  },
  'departments.release'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    floor.departments.release(str(msg.id, 16), str(msg.workerId, 32));
  },
  'departments.launch'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    const task = str(msg.prompt, 20000) || undefined;
    const liveAgents = () => floor.workers.list().filter((w) => w.kind === 'agent').map((w) => w.id);
    const hire = () => {
      // Re-checked here, after the sign-in and the fresh fetch: the cap, the department, the role
      // and the desk as they are now, so two launches at once can't both pass a stale check.
      const composed = floor.departments.composeLaunch(str(msg.id, 16), str(msg.role, 16), task, liveAgents);
      if (typeof composed === 'string') return ctx.warn(c, composed);
      const dept = floor.departments.get(str(msg.id, 16))!;
      // A desk in the department's corner first; the office's next free seat when it's full.
      const desk = [...roomDeskIds(dept.preset), ...dept.desks].find((d) => !floor.workers.deskOccupied(d)) ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
      if (!desk) return ctx.warn(c, 'No free desk — knock the back office out a row first');
      // A writer works in a worktree of its own, always; a reviewer may work in the checkout.
      const worktree = composed.role.kind === 'implementation' || !!floor.project.branch;
      const r = floor.workers.spawn(desk, who, composed.prompt, worktree, 'agent', msg.provider, model, effort, undefined, c.accountId);
      if (typeof r === 'string') return ctx.warn(c, r);
      floor.departments.recordHire(dept.id, composed.role.id, r.id, desk, who);
      ctx.toastFloor(floor, `🏬 ${who} hired ${r.name} as the ${dept.name} department's ${composed.role.name}`);
    };
    ctx.withSignIn(c, ctx.signInFor(msg.provider ?? floor.workers.officeDefault.provider), () => ctx.withFreshBase(c, [floor], hire));
  },
} satisfies HandlerMap<DepartmentsClientMsg>;
