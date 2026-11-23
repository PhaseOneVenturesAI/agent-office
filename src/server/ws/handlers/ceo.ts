// The floor's CEO (see server/ceo.ts and docs/department-leads.md): one persistent identity per
// project, privately owned. Naming, shifts and assignments are explicit — nothing here ever starts
// an agent by itself — and every edit is authorized: only the owner talks to or edits the CEO;
// ownership itself changes through admin control only.
import { nextFreeSeat } from '../../../shared/layout.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type CeoClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { canEditCeo, canDelegateManager } from '../../role-access.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const ceoView: ViewPieces['ceo'] = (_ctx, floor) => floor?.ceo.state() ?? {};

export const ceoHandlers = {
  'ceo.set'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    // Ownership passes only by delegation from the current owner (or an admin's first setup when
    // no owner exists anywhere); office-admin status alone is never a way in.
    if (msg.owner !== undefined) {
      const editOwner = canEditCeo(ctx, floor, c.accountId);
      if (!editOwner.ok) return ctx.warn(c, editOwner.why);
      const revoked = ctx.roleSubscriptions?.revokeFloor(floor.id);
      if (revoked) return ctx.warn(c, revoked);
    }
    const edit = canEditCeo(ctx, floor, c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const err = floor.ceo.set({ name: str(msg.name, 60), ...(msg.provider !== undefined ? { provider: msg.provider } : {}), ...(model !== undefined ? { model } : {}), ...(isAgentEffort(msg.effort) ? { effort: msg.effort } : {}), ...(msg.autonomy !== undefined ? { autonomy: str(msg.autonomy, 40) } : {}), ...(msg.owner !== undefined ? { owner: str(msg.owner, 120) } : {}) }, c.peer.name);
    if (err) ctx.warn(c, err);
  },
  'ceo.clear'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditCeo(ctx, floor, c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    const revoked = ctx.roleSubscriptions?.revokeFloor(floor.id);
    if (revoked) return ctx.warn(c, revoked);
    const live = floor.ceo.get()?.workerId;
    ctx.warn(c, floor.ceo.clear());
    // Retiring the role sends its worker home: deleting the role is what frees the seat.
    if (live && !floor.ceo.get()?.workerId) void floor.sendHome(live);
  },
  'ceo.launch'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditCeo(ctx, floor, c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    const task = str(msg.prompt, 20000) || undefined;
    const saved = floor.ceo.savedChoice();
    const provider = msg.provider ?? saved?.provider;
    // The real live list: the duplicate-shift check must see the CEO's own worker.
    const liveAgents = () => floor.workers.list().filter((w) => w.kind === 'agent').map((w) => w.id);
    const hire = () => {
      const composed = floor.ceo.composeLaunch(task, liveAgents);
      if (typeof composed === 'string') return ctx.warn(c, composed);
      const desk = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
      if (!desk) return ctx.warn(c, 'No free desk — knock the back office out a row first');
      const r = floor.workers.spawn(desk, who, composed.prompt, !!floor.project.branch, 'agent', provider, model ?? saved?.model, effort ?? saved?.effort, undefined, c.accountId, [], undefined, composed.ceo.name);
      if (typeof r === 'string') return ctx.warn(c, r);
      floor.ceo.recordHire(r.id, who);
      ctx.toastFloor(floor, `👔 ${who} started ${r.name}'s shift as the CEO`);
    };
    ctx.withSignIn(c, ctx.signInFor(provider ?? floor.workers.officeDefault.provider), () => ctx.withFreshBase(c, [floor], hire));
  },
  'ceo.assign'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditCeo(ctx, floor, c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    const objective = str(msg.objective, 4000);
    if (!objective.trim()) return ctx.warn(c, 'Say what the manager is to achieve');
    const dept = floor.departments.state().departments.find((d) => d.preset === msg.dept);
    if (!dept) return ctx.warn(c, 'Open that department on this floor first');
    const r = floor.assignObjective(dept.id, objective, c.peer.name, { execute: msg.execute === true, owner: c.accountId });
    if (typeof r === 'string') ctx.warn(c, r);
    else ctx.toastFloor(floor, `🎯 ${c.peer.name} gave ${r.manager} an objective${r.started ? ' and started their shift' : ''}`);
  },
} satisfies HandlerMap<CeoClientMsg>;
