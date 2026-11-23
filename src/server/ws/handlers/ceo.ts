// The floor's CEO (see server/ceo.ts and docs/department-leads.md): one persistent identity per
// project. Naming, shifts and assignments are explicit — nothing here ever starts an agent by
// itself, and assignments reach managers only through the floor's own dispatch (never a
// busy-terminal injection, never a cross-floor call).
import { nextFreeSeat } from '../../../shared/layout.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type CeoClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
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
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const err = floor.ceo.set({ name: str(msg.name, 60), ...(msg.provider !== undefined ? { provider: msg.provider } : {}), ...(model !== undefined ? { model } : {}), ...(isAgentEffort(msg.effort) ? { effort: msg.effort } : {}) }, c.peer.name);
    if (err) ctx.warn(c, err);
  },
  'ceo.clear'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    ctx.warn(c, floor.ceo.clear());
  },
  'ceo.launch'(ctx, c, msg) {
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
    const saved = floor.ceo.savedChoice();
    const provider = msg.provider ?? saved?.provider;
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
    const objective = str(msg.objective, 4000);
    if (!objective.trim()) return ctx.warn(c, 'Say what the manager is to achieve');
    const dept = floor.departments.state().departments.find((d) => d.preset === msg.dept);
    if (!dept) return ctx.warn(c, 'Open that department on this floor first');
    const r = floor.assignObjective(dept.id, objective, c.peer.name, { execute: msg.execute === true, owner: c.accountId });
    if (typeof r === 'string') ctx.warn(c, r);
    else ctx.toastFloor(floor, `🎯 ${c.peer.name} gave ${r.manager} an objective${r.started ? ' and started their shift' : ''}`);
  },
} satisfies HandlerMap<CeoClientMsg>;
