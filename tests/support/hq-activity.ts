import { HQ } from '../../src/server/hq/index.js';
import { HQMac } from '../../src/server/hq/mac.js';
import { Nodes } from '../../src/server/nodes.js';
import { Building } from '../../src/server/building.js';
import { Cubbies } from '../../src/server/cubbies/index.js';
import { hqView } from '../../src/server/hq/views.js';
import { talkView } from '../../src/server/hq/talk-views.js';
import { socket } from './draft-board.js';
import type { Ctx } from '../../src/server/office/context.js';

export function activityOffice(dir: string, now = Date.now, changed = () => {}) {
  const building = new Building(dir, dir);
  const names: Record<string, string> = { owner: 'Jonathan', manager: 'Ivan', coworker: 'Coworker' };
  const hq = new HQ(dir, 'Jonathan', 'Ivan', id => ({ name: names[id] ?? id }), building);
  let mac: HQMac;
  const nodes = new Nodes(dir, () => mac?.refresh());
  const cubbies = new Cubbies(dir, true, nodes, id => names[id], () => true, () => {});
  hq.mac = mac = new HQMac(dir, hq, nodes, changed, now);
  const floors = new Map([['hq', { id: 'hq', def: { name: 'HQ' } }], ['plimbo', { id: 'plimbo', def: { name: 'Plimbo', repo: 'owner/plimbo' } }]]);
  const clients = new Map();
  const ctx = { hq, nodes, cubbies, floors, clients, floorOf: (c: any) => floors.get(c.floorId), accounts: { get: (id: string) => ({ name: names[id] }) }, sendTo() {} } as unknown as Ctx;
  const client = (role: string, floor = 'hq') => { const c = { id: role, accountId: role, floorId: floor, ws: socket() } as any; clients.set(role, c); return c; };
  const invite = mac.setup('owner', 'hq');
  const link = socket(); nodes.attach(link as any, invite.token); link.frame({ t: 'hello', host: 'fixture', providers: [] });
  const node = nodes.state({ id: 'owner' }).nodes[0].id;
  const admit = () => link.frame({ t: 'hq.hello', computerId: 'test-mac', computerName: 'Mac mini' });
  const snapshot = () => link.frame({ t: 'hq.snapshot', computerId: 'test-mac', observedAt: now(), projects: [{
    project: { name: 'Plimbo', repo: 'owner/plimbo', hasMainLead: true, lead: 'private-main-session', leadStatus: { status: 'idle', updatedAt: now() },
      departmentLeads: [{ department: 'Design', title: 'Design lead', lead: 'private-design-session', leadStatus: { status: 'busy', updatedAt: now() } }] },
    agents: [
      { id: 'harness:private-worker', kind: 'worker', role: 'builder', task: 'Homepage worker', tool: 'codex', status: 'working', lastTool: 'reading layout.tsx', branch: 'feature', lead: 'private-main-session' },
      { id: 'harness:private-factory', kind: 'factory', role: 'factory', task: 'Release factory', tool: 'claude', status: 'working', lastTool: 'running tests', branch: 'feature', lead: 'private-main-session' },
    ],
  }] });
  return { ctx, mac, nodes, link, node, admit, snapshot, client,
    hqView: (role = 'owner') => { const c = client(role); return hqView(ctx, floors.get('hq') as any, c); },
    talkView: (role = 'owner', floor = 'hq') => talkView(ctx, client(role, floor)), close: () => nodes.close() };
}
