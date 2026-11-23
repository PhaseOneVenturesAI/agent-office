// Departments: the floor's corners of work (see server/departments.ts). Everything but launch is
// paperwork on the floor's store; launch goes through the same spawn as every hire, after the
// department composed the worker's prompt.
import { nextFreeSeat } from '../../../shared/layout.js';
import { normTitle } from '../../queue.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import { isAgentEffort, isAgentProvider, type DepartmentsClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { canEditManager, canDelegateManager, roleAccessForManager } from '../../role-access.js';
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
    const edit = canEditManager(ctx, floor, str(msg.id, 16), c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
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
    const liveAgents = () => floor.writerIds();
    const hire = () => {
      // Re-checked here, after the sign-in and the fresh fetch: the cap, the department, the role
      // and the desk as they are now, so two launches at once can't both pass a stale check.
      const composed = floor.departments.composeLaunch(str(msg.id, 16), str(msg.role, 16), task, liveAgents);
      if (typeof composed === 'string') return ctx.warn(c, composed);
      const dept = floor.departments.get(str(msg.id, 16))!;
      // A desk in the department's corner first; the office's next free seat when it's full.
      const desk = dept.desks.find((d) => !floor.workers.deskOccupied(d)) ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
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
  'departments.lead'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditManager(ctx, floor, str(msg.id, 16), c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const err = floor.departments.setLead(str(msg.id, 16), { name: str(msg.name, 60), ...(msg.provider !== undefined ? { provider: msg.provider } : {}), ...(model !== undefined ? { model } : {}), ...(isAgentEffort(msg.effort) ? { effort: msg.effort } : {}), ...(msg.autonomy !== undefined ? { autonomy: str(msg.autonomy, 40) } : {}) }, c.peer.name);
    if (err) ctx.warn(c, err);
  },
  'departments.access'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canDelegateManager(ctx, floor, str(msg.id, 16), c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    const ask = msg as { controllers?: unknown; audience?: unknown; custodian?: unknown };
    ctx.warn(c, floor.departments.setAccess(str(msg.id, 16), { ...(ask.controllers !== undefined ? { controllers: ask.controllers } : {}), ...(ask.audience !== undefined ? { audience: ask.audience } : {}), ...(ask.custodian !== undefined ? { custodian: ask.custodian } : {}) }));
  },
  'departments.lead.clear'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const id = str(msg.id, 16);
    const live = floor.departments.get(id)?.lead?.workerId;
    ctx.warn(c, floor.departments.clearLead(id));
    // Retiring the manager sends their worker home: deleting the role is what frees the seat.
    if (live && !floor.departments.get(id)?.lead?.workerId) void floor.sendHome(live);
  },
  'departments.policy'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditManager(ctx, floor, str(msg.id, 16), c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    if (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider)) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const err = floor.departments.setPolicy(str(msg.id, 16), { provider: msg.provider, ...(model !== undefined ? { model } : {}), ...(isAgentEffort(msg.effort) ? { effort: msg.effort } : {}), mode: msg.mode === 'ask' ? 'ask' : 'policy' }, c.peer.name);
    if (err) ctx.warn(c, err);
  },
  'departments.lead.launch'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const edit = canEditManager(ctx, floor, str(msg.id, 16), c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const id = str(msg.id, 16);
    const ask = floor.departments.get(id)?.policy?.mode === 'ask';
    // An explicit pick is the ask-mode picker (a person deciding); policy/lead engine otherwise.
    const explicit = ask ? { provider: msg.provider, model: msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1), effort: isAgentEffort(msg.effort) ? msg.effort : undefined } : undefined;
    const engine = floor.departments.get(id)?.policy?.provider ?? floor.departments.leadChoice(id)?.provider;
    const task = str(msg.prompt, 20000) || undefined;
    const hire = () => {
      const r = floor.startManager(id, who, c.accountId, explicit, task);
      if (typeof r === 'string') return ctx.warn(c, r);
      const dept = floor.departments.get(id)!;
      ctx.toastFloor(floor, `🎖️ ${who} started ${r.name}'s shift as the ${dept.name} manager`);
    };
    ctx.withSignIn(c, ctx.signInFor((ask ? msg.provider : undefined) ?? engine ?? floor.workers.officeDefault.provider), () => ctx.withFreshBase(c, [floor], hire));
  },
  'departments.delegate'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const id = str(msg.id, 16);
    const dept = floor.departments.get(id);
    if (!dept) return ctx.warn(c, 'That department is gone');
    const edit = canEditManager(ctx, floor, id, c.accountId);
    if (!edit.ok) return ctx.warn(c, edit.why);
    const title = str(msg.title, 200);
    const task = str(msg.task, 20000).replace(/\r\n?/g, '\n').trim();
    if (!title || !task) return ctx.warn(c, 'Give the delegation a title and the task');
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    // The lead delegates on the policy engine unless the ask-mode picker sent an explicit choice.
    const policy = dept.policy;
    const provider = msg.provider ?? policy?.provider;
    const chosenModel = model ?? (msg.provider === undefined ? policy?.model : undefined);
    const chosenEffort = effort ?? (msg.provider === undefined ? policy?.effort : undefined);
    const by = dept.lead ? `${dept.lead.name} (lead)` : who;
    // The claim refuses before the cap: "already assigned" is the truer answer (queue.add re-checks).
    if (floor.queue.state().tasks.some((t) => t.status !== 'done' && normTitle(t.title) === normTitle(title))) return ctx.warn(c, `“${title}” is already assigned on this project`);
    // The task will seat an implementation writer: the project's cap holds here too.
    const cap = floor.writerCap();
    if (cap) return ctx.warn(c, cap);
    const parentId = dept.lead?.workerId && floor.workers.get(dept.lead.workerId) ? dept.lead.workerId : undefined;
    ctx.withSignIn(c, ctx.signInFor(provider ?? floor.workers.officeDefault.provider), () => {
      const err = floor.delegate(id, title, task, by, c.accountId, parentId, { provider, model: chosenModel, effort: chosenEffort });
      if (err) ctx.warn(c, err);
      else ctx.toastFloor(floor, `📋 ${by} delegated “${title}” to the floor queue`);
    });
  },
  'departments.request.approve'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const id = str(msg.id, 16);
    const dept = floor.departments.get(id);
    if (!dept) return ctx.warn(c, 'That department is gone');
    const policy = dept.policy;
    const provider = msg.provider ?? policy?.provider;
    // Seating an implementation writer: the cap holds at approval time, before the request is spent.
    const cap = floor.writerCap();
    if (cap) return ctx.warn(c, `${cap} — the request stays pending`);
    const taken = floor.departments.takeRequest(id, str(msg.request, 16));
    if (typeof taken === 'string') return ctx.warn(c, taken);
    const model = msg.model !== undefined ? str(msg.model, OPEN_CODE_MODEL_MAX + 1) : policy?.model;
    const effort = isAgentEffort(msg.effort) ? msg.effort : policy?.effort;
    const by = dept.lead ? `${dept.lead.name} (lead)` : c.peer.name;
    const parentId = dept.lead?.workerId && floor.workers.get(dept.lead.workerId) ? dept.lead.workerId : undefined;
    ctx.withSignIn(c, ctx.signInFor(provider ?? floor.workers.officeDefault.provider), () => {
      const err = floor.delegate(id, taken.title, taken.task, by, c.accountId, parentId, { provider, model, effort });
      if (err) ctx.warn(c, `${err} — the request is cleared; the job is claimed elsewhere or the queue refused it`);
      else ctx.toastFloor(floor, `📋 ${by}'s “${taken.title}” approved and queued`);
    });
  },
  'departments.request.reject'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const err = floor.departments.dropRequest(str(msg.id, 16), str(msg.request, 16));
    if (err) ctx.warn(c, err);
    else ctx.toastFloor(floor, `${c.peer.name} rejected a delegation request`);
  },
  'departments.ask'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const id = str(msg.id, 16);
    const dept = floor.departments.get(id);
    if (!dept?.lead) return ctx.warn(c, 'Name the manager first');
    // Read-only Q&A is for staff; controllers and the owner talk to the manager directly.
    const access = roleAccessForManager(ctx, floor, id, c.accountId);
    if (access.kind === 'none') return ctx.warn(c, access.why);
    void floor.staffQA(id, str(msg.question, 4000), c.peer.name).then((outcome) => {
      if (c.out || !ctx.stillIn(c)) return;
      ctx.sendTo(c, { t: 'departments.qa', id, question: str(msg.question, 4000), answer: outcome.ok ? outcome.answer : `Unavailable: ${outcome.why}`, at: Date.now() });
    });
  },
} satisfies HandlerMap<DepartmentsClientMsg>;
