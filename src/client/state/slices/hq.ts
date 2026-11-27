import type { Slice } from '../store';
import { cleanProjects, type HQView } from '../../../shared/protocol/hq';
import { isOwnerColor } from '../../../shared/personal-agents/appearance';
declare module '../store' {
  interface Store { hq?: HQView }
  interface Topics { hq: true }
}
function clean(v?: HQView): HQView | undefined {
  if (!v || typeof v.floorId !== 'string' || typeof v.ownerName !== 'string' || !isOwnerColor(v.ownerColor)) return;
  return { floorId: v.floorId, ownerName: v.ownerName.slice(0, 60), ownerColor: v.ownerColor, mine: v.mine === true, projects: cleanProjects(v.projects), leads: v.leads };
}
export const hq: Slice = {
  init(s) { s.hq = undefined; },
  on: { hq(s, m) { s.hq = m.view?.floorId === s.floor ? clean(m.view) : undefined; return ['hq']; } },
  enter(s, v) { s.hq = clean(v.hq); return ['hq']; },
};
