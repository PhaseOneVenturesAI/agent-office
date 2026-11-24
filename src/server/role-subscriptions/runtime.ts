import { confirmedAutonomy } from '../providers/autonomy.js';
import type { Floor, FloorContext } from '../floor.js';
import type { AgentProvider, AgentEffort, WorkerInfo } from '../../shared/protocol.js';
import { nextFreeSeat } from '../../shared/layout.js';
export function startManager(floor: Floor, authorize: FloorContext['managerExecution'], deptId: string, by: string, owner: string | undefined, explicit?: { provider?: AgentProvider; model?: string; effort?: AgentEffort }, task?: string): WorkerInfo | string {
    const dept = floor.departments.get(deptId);
    if (!dept) return 'That department is gone';
    const policy = dept.policy;
    const saved = floor.departments.leadChoice(deptId);
    const provider = explicit?.provider ?? policy?.provider ?? saved?.provider;
    const authorization = authorize?.(floor, deptId, owner, provider ?? floor.workers.officeDefault.provider);
    if (authorization?.error) return authorization.error;
    if (authorization) owner = authorization.owner;
    const model = explicit?.model ?? (explicit?.provider === undefined ? policy?.model : undefined) ?? saved?.model;
    const effort = explicit?.effort ?? (explicit?.provider === undefined ? policy?.effort : undefined) ?? saved?.effort;
    // The duplicate-shift check must see every live agent record — an idle, done, or offline
    // manager is still seated, even though writerIds() (cap accounting) excludes them.
    const liveAgents = () => floor.workers.list().filter((w) => w.kind === 'agent').map((w) => w.id);
    const composed = floor.departments.composeLeadLaunch(deptId, task, liveAgents);
    if (typeof composed === 'string') return composed;
    const fresh = floor.departments.get(deptId)!;
    const desk = fresh.desks.find((d) => !floor.workers.deskOccupied(d)) ?? nextFreeSeat((x) => floor.workers.deskOccupied(x), floor.plan.wing)?.id;
    if (!desk) return 'No free desk — knock the back office out a row first';
    // The lead orchestrates rather than writes: it takes a worktree only when every worker here has one.
    const r = floor.workers.spawn(desk, by, composed.prompt, !!floor.project.branch, 'agent', provider, model, effort, undefined, owner, [], undefined, composed.lead.name, confirmedAutonomy(composed.lead));
    if (typeof r === 'string') return r;
    floor.departments.recordLeadHire(deptId, r.id, desk, by);
    return r;
  }

export function assignObjective(floor: Floor, authorize: FloorContext['managerExecution'], deptId: string, objective: string, by: string, opts?: { execute?: boolean; owner?: string }): string | { manager: string; started: boolean } {
    const dept = floor.departments.get(deptId);
    if (!dept) return 'That department is gone';
    if (!dept.lead) return `Name the ${dept.name} manager first`;
    const liveWorker = dept.lead.workerId ? floor.workers.get(dept.lead.workerId) : undefined;
    const authorization = authorize?.(floor, deptId, opts?.owner, liveWorker?.provider);
    if (authorization?.error) return authorization.error;
    if (liveWorker && authorization && floor.workers.ownerOf(liveWorker.id) !== authorization.owner) return 'The seated manager uses a different subscription. Its active credentials were not changed; arrange an explicit replacement.';
    const err = floor.departments.setObjective(deptId, objective, by);
    if (err) return err;
    const from = floor.ceo.get()?.name ?? by;
    const text = `🎯 ${from} (CEO): ${objective}`;
    const live = dept.lead.workerId ? floor.workers.get(dept.lead.workerId) : undefined;
    if (live) {
      // Delivered now when idle, held (never injected mid-turn) while their turn runs.
      floor.dispatch.hold(live.id, `objective:${deptId}`, text);
      return { manager: live.name, started: false };
    }
    if (opts?.execute !== true) return `${dept.lead.name} is off shift — start them from the panel, or ask the CEO to execute`;
    if (dept.policy?.mode === 'ask') return `The ${dept.name} policy asks each time — start ${dept.lead.name} from the panel, where the engine is picked`;
    const r = floor.startManager(deptId, by, opts.owner);
    if (typeof r === 'string') return r;
    floor.dispatch.hold(r.id, `objective:${deptId}`, text);
    return { manager: r.name, started: true };
  }

