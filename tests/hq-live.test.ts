import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { presence } from '../src/server/cubbies/local/presence.js';
import { readNeeds, needsFor } from '../src/server/cubbies/local/needs.js';
import { readProjects } from '../src/server/hq/projects.js';
import { cleanProjects, publicProjects, leadId } from '../src/shared/protocol/hq.js';
import { projectLeads, leadWhere, type LeadSource } from '../src/server/hq/leads.js';
import { liveProjects } from '../src/server/hq/live.js';
import { snapshot } from '../src/server/cubbies/snapshot.js';
import type { HQProject } from '../src/shared/protocol/hq.js';

function files(t: any) {
  mkdirSync('.paradev', { recursive: true });
  const dir = realpathSync(mkdtempSync(path.resolve('.paradev/hq-live-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo'), tree = path.join(dir, 'tree'), runs = path.join(dir, 'runs');
  for (const p of [repo, tree, runs]) mkdirSync(p);
  return { dir, repo, tree, runs };
}
const needs = { open: 2, items: ['<img src=x onerror=alert(1)> Review'], stale: false, at: new Date().toISOString() };
const p: HQProject = { own: true, name: 'Office', lead: 'main-lead', hasMainLead: true, departmentLeads: [{ department: 'Design', title: 'Design lead', lead: 'design-lead' }], needs };
const agent = (id: number, lead?: string) => ({ id: `harness:${id}`, tool: 'codex', role: 'builder' as const, task: `Task ${id}`, branch: 'refs/heads/topic', status: 'working' as const, startedAt: id, ...(lead ? { lead } : {}) });
const source = (): LeadSource => ({ floorId: 'project', projects: [p], cubby: { id: 'cubby', slot: 0, ownerName: 'Owner', mine: true, lamp: 'working', working: 1,
  interior: { computerName: 'Mac', leadName: 'Lead', look: { skin: 0, hair: 0, style: 0 }, agents: [agent(1, p.lead), agent(2, 'design-lead'), agent(3), agent(4, 'unknown')], needsYou: [], plan: [], chat: [] } } });

test('presence lead identity is strict, bounded, additive and scoped; dead and malformed files disappear', t => {
  const f = files(t);
  for (const [i, lead] of ['a_B.c:d-2', 'a'.repeat(80), 'a'.repeat(81), 'bad\nlead', '<script>', undefined].entries()) {
    writeFileSync(path.join(f.runs, `${i + 10}-abcd1234.json`), JSON.stringify({ schema: 1, pid: i + 10, provider: 'codex', role: 'builder', folder: f.tree, lead, title: 'Clean\u0000title', startedAt: needs.at }));
  }
  writeFileSync(path.join(f.runs, '99-abcd1234.json'), '{malformed');
  const records = presence([f.repo, f.tree], f.runs, pid => pid !== 15);
  assert.equal(records.length, 5); assert.equal(records[0].agent.lead, 'a_B.c:d-2'); assert.equal(records[1].agent.lead?.length, 80);
  assert.ok(records.slice(2).every(r => !r.agent.lead)); assert.equal(records[0].agent.task, 'Clean title');
  assert.deepEqual(presence([f.repo], f.runs, () => true), []);
  assert.deepEqual(presence([f.repo], path.join(f.dir, 'missing')), []);
  for (const bad of [null, '', {}, 'x/y', 'a'.repeat(81)]) assert.equal(leadId(bad), undefined);
  const frame = snapshot({ agents: [agent(1, 'valid'), agent(2, 'bad\u0000')], observedAt: Date.now() }, Date.now())!;
  assert.equal(frame.agents[0].lead, 'valid'); assert.equal(frame.agents[1].lead, undefined);
});

test('needs file is bounded and read-only; missing, malformed, unknown counts, staleness and exact path matching', t => {
  const f = files(t), file = path.join(f.dir, 'needs.json'), now = Date.now();
  assert.deepEqual(readNeeds(file), { entries: [] });
  const publication = { schema: 1, generatedAt: new Date(now - 25 * 3600_000).toISOString(), staleAfterHours: 24,
    projects: { registryName: { path: f.repo, open: null, items: ['x'.repeat(200), 'two\u0000', 'three', 'four'], sources: [{ path: '/NEVER_READ' }] } } };
  writeFileSync(file, JSON.stringify(publication)); const before = readFileSync(file);
  let read = readNeeds(file, now), n = needsFor(read, f.tree, [f.repo, f.tree])!;
  assert.equal(n.open, null); assert.equal(n.stale, true); assert.equal(n.items.length, 3); assert.equal(n.items[0].length, 160); assert.equal(n.items[1], 'two');
  assert.deepEqual(readFileSync(file), before); assert.equal(needsFor(read, f.repo + '-prefix'), undefined);
  const alias = path.join(f.dir, 'alias'); symlinkSync(f.repo, alias); assert.ok(needsFor(read, alias));
  publication.generatedAt = new Date(now).toISOString(); writeFileSync(file, JSON.stringify(publication));
  assert.equal(needsFor(readNeeds(file, now), f.repo)?.stale, false);
  read.entries.push(read.entries[0]); assert.equal(needsFor(read, f.repo), undefined, 'ambiguous matches never guessed');
  for (const invalid of ['{', 'x'.repeat(65537), JSON.stringify({ ...publication, schema: 2 }), JSON.stringify({ ...publication, staleAfterHours: 0 }), JSON.stringify({ ...publication, projects: { x: { path: f.repo, open: -1, items: [] } } })]) {
    writeFileSync(file, invalid); assert.deepEqual(readNeeds(file), { entries: [], error: true });
  }
  const link = path.join(f.dir, 'needs-link'); symlinkSync(file, link); assert.equal(readNeeds(link).error, true);
});

test('registry needs match worktree paths, never display names; project and wire cleaning retain only bounded metadata', t => {
  const f = files(t), registry = path.join(f.dir, 'projects.json');
  writeFileSync(registry, JSON.stringify({ projects: { otherName: { name: 'Office', path: f.repo, leadSessionId: 'main-lead', departmentLeads: [{ department: 'Design', title: 'Design', sessionId: 'design-lead' }] } } }));
  const projects = readProjects(registry, { project: f.tree, roots: [f.repo, f.tree] }, { entries: [{ path: f.tree, needs }] });
  assert.equal(projects[0].needs?.open, 2); assert.equal(projects[0].own, true); assert.equal(projects[0].lead, 'main-lead');
  assert.deepEqual(cleanProjects(projects), projects);
  const manager = publicProjects(projects, false), owner = publicProjects(projects, true);
  assert.deepEqual(manager[0].needs?.items, []); assert.equal(owner[0].needs?.items[0], needs.items[0]);
  assert.doesNotMatch(JSON.stringify(manager), /main-lead|design-lead|onerror|sources|path/);
});

test('one helper per HQ floor, exact lead desk or scoped CEO fallback, newest first; unscoped workers excluded', () => {
  const s = source(), result = liveProjects([p], [s, s]);
  assert.equal(result[0].workers?.length, 4); assert.equal(new Set(result[0].workers?.map(w => w.id)).size, 4);
  assert.deepEqual(result[0].workers?.map(w => w.id), ['harness:4', 'harness:3', 'harness:2', 'harness:1']);
  assert.equal(result[0].workers?.find(w => w.id === 'harness:2')?.departmentIndex, 0);
  assert.ok(result[0].workers?.filter(w => w.id !== 'harness:2').every(w => w.departmentIndex === undefined));
  assert.deepEqual(liveProjects([p], [{ ...s, projects: [], cubby: { ...s.cubby, interior: { ...s.cubby.interior!, agents: [agent(8, 'unknown')] } } }])[0].workers, undefined);
  assert.equal(liveProjects([p], [{ ...s, cubby: { ...s.cubby, lamp: 'asleep' } }])[0].workers, undefined);
});

test('leadWhere precedence and source scope; CEO needs OR, department exclusion and manager privacy', () => {
  const s = source(), floors = [{ id: 'project' }];
  const leads = projectLeads([p], [s], floors, true);
  assert.deepEqual(leads.map(l => l.where), ['project', 'project']); assert.equal(leads[0].needsYou, true); assert.equal(leads[1].needsYou, false);
  const managers = projectLeads([p], [s], floors, false);
  assert.deepEqual(managers[0].needs?.items, []); assert.doesNotMatch(JSON.stringify(managers), /onerror/);
  assert.deepEqual(projectLeads([p], [s], [], true).map(l => l.where), ['hq', 'hq']);
  assert.equal(projectLeads([{ ...p, lead: 'elsewhere' }], [{ ...s, projects: [{ ...p, lead: 'elsewhere' }] }], floors, true)[0].where, 'hq');
  const pitch: any = { status: 'ready', pieces: [{}] };
  assert.equal(leadWhere(pitch, true, true), 'pitch'); assert.equal(leadWhere(undefined, true, true), 'project'); assert.equal(leadWhere(undefined, false, true), 'hq');
  assert.equal(leadWhere({ ...pitch, pieces: [{ stamp: {} }] }, true, true), 'project');
  s.cubby.interior!.needsYou = ['Existing private line'];
  const zero = projectLeads([{ ...p, needs: { ...needs, open: 0 } }], [s], floors, false)[0];
  assert.equal(zero.needsYou, true); assert.deepEqual(zero.cubby?.interior?.needsYou, []);
});
