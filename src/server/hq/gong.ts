import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
import { ownerId } from './views.js';
import { projectFloor } from './leads.js';

const seen = new WeakMap<Ctx, Set<string>>();
/** Called only by the existing floor emission after merges.ring accepted a merge. No polling. */
export function hqFloorEmit(ctx: Ctx): Ctx['toFloor'] {
  return (floor: Floor, msg: ServerMsg) => {
    ctx.toFloor(floor, msg);
    if (msg.t !== 'gong' || msg.why !== 'merged' || !msg.pr || !ctx.hq?.enabled || ctx.hq.is(floor.id)) return;
    const owner = ownerId(ctx);
    if (!owner) return;
    const sources = ctx.cubbies.hqSources(owner);
    const projects = ctx.cubbies.hqProjects(owner) ?? [];
    const project = projects.find(p => projectFloor(p, sources[0]?.floorId, [...ctx.floors.values()].map(f => ({ id: f.id, repo: f.def.repo }))) === floor.id);
    if (!project) return;
    const key = `${floor.def.repo?.toLowerCase() ?? floor.id}:${msg.pr}`, sent = seen.get(ctx) ?? new Set<string>();
    if (sent.has(key)) return;
    sent.add(key); seen.set(ctx, sent);
    for (const c of ctx.clients.values()) {
      const id = ctx.floorOf(c)?.id;
      if (id && !c.out && ctx.hq.is(id) && ctx.hq.visible(id, c.accountId)) ctx.sendTo(c, { t: 'hq.gong', project: project.name, pr: msg.pr });
    }
  };
}
