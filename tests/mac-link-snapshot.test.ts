import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { macSnapshot } from '../src/server/hq/local/snapshot.js';
import { configureMac } from '../src/server/hq/local/config.js';
import { sessionStatuses } from '../src/server/hq/local/sessions.js';
import { projectLeads } from '../src/server/hq/leads.js';
import { publicProjects } from '../src/shared/protocol/hq.js';
function fixture(t: any) {
  mkdirSync('.paradev', { recursive: true });
  const home = realpathSync(mkdtempSync(path.resolve('.paradev/link-snapshot-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sessions = path.join(home, '.claude/sessions'); mkdirSync(sessions, { recursive: true });
  const registry = path.join(home, 'Documents/GitHub/AgentHarness/projects.json'); mkdirSync(path.dirname(registry), { recursive: true });
  const runs = path.join(home, 'Library/Application Support/AgentHarness/runs'); mkdirSync(runs, { recursive: true });
  return { home, sessions, registry, runs };
}
test('session registry uses only busy/idle/off, handles malformed/dead/missing files and bounds files', t => {
  const f = fixture(t), now = Date.now();
  const write = (name: string, row: unknown) => writeFileSync(path.join(f.sessions, name + '.json'), JSON.stringify(row));
  write('busy', { sessionId: 'busy-id', status: 'busy', updatedAt: now, pid: 100, cwd: '/private', socketPath: '/secret/socket' });
  write('idle', { sessionId: 'other', bridgeSessionId: 'app-id', status: 'idle', updatedAt: new Date(now).toISOString(), pid: 101 });
  write('dead', { sessionId: 'dead-id', status: 'busy', updatedAt: now, pid: 102 });
  write('unknown', { sessionId: 'unknown-id', status: 'something', updatedAt: now, pid: 100 });
  write('large', { sessionId: 'large-id', status: 'busy', updatedAt: now, pid: 100, padding: 'x'.repeat(16 * 1024) });
  writeFileSync(path.join(f.sessions, 'broken.json'), '{');
  const get = sessionStatuses(f.home, pid => pid !== 102, now);
  assert.deepEqual(get(['busy-id']), { status: 'busy', updatedAt: now });
  assert.deepEqual(get(['app-id']), { status: 'idle', updatedAt: now });
  for (const id of ['dead-id','unknown-id','large-id','missing']) assert.equal(get([id]).status, 'off');
  assert.doesNotMatch(JSON.stringify(get(['busy-id'])), /pid|cwd|socket|sessionId/);
  for (let i = 0; i < 300; i++) write(`extra-${i}`, { sessionId: `extra-${i}`, status: 'busy', updatedAt: now, pid: 1000 + i });
  let calls = 0; sessionStatuses(f.home, () => { calls++; return true; }, now); assert.ok(calls <= 256);
});
test('snapshot excludes hidden/archived/remote-only projects including workers and needs; statuses and draft boards are cleaned', async t => {
  const f = fixture(t), now = Date.now(), projects: Record<string, any> = {}, needs: Record<string, any> = {};
  const names = ['Live','Hidden','Archived','Remote'];
  for (let i = 0; i < names.length; i++) {
    const name = names[i], repo = path.join(f.home, name); mkdirSync(repo);
    projects[name] = { path: repo, leadSessionId: `${name}-lead`, leadAppSession: `${name}-app`, departmentLeads: [null, { department: 'Design', title: 'Design lead', sessionId: 'design-id', appSession: 'design-app' }] };
    needs[name] = { path: repo, open: 1, items: [name + '-needs'] };
    writeFileSync(path.join(f.runs, `${100 + i}-abc.json`), JSON.stringify({ schema: 1, pid: 100 + i, folder: repo, provider: 'codex', role: 'builder', lead: `${name}-lead`, title: name + '-work' }));
  }
  projects.Hidden.office = 'hidden'; projects.Archived.localState = 'archived'; projects.Remote.localState = 'remote-only';
  projects.Live.lead = { text: 'FORBIDDEN' }; projects.Live.note = 'FORBIDDEN'; projects.Live.creativeLineage = 'FORBIDDEN';
  writeFileSync(f.registry, JSON.stringify({ projects }));
  writeFileSync(path.join(path.dirname(f.runs), 'needs.json'), JSON.stringify({ schema: 1, generatedAt: new Date(now).toISOString(), staleAfterHours: 24, projects: needs }));
  writeFileSync(path.join(f.sessions, 'main.json'), JSON.stringify({ sessionId: 'different', bridgeSessionId: 'Live-app', pid: 500, status: 'busy', updatedAt: now, cwd: '/secret/cwd', socketPath: '/secret/sock', name: 'PRIVATE NAME' }));
  writeFileSync(path.join(f.sessions, 'design.json'), JSON.stringify({ sessionId: 'design-id', pid: 501, status: 'idle', updatedAt: now }));
  const folder = path.join(projects.Live.path, '.agent-office'); mkdirSync(folder);
  writeFileSync(path.join(folder, 'draft.json'), JSON.stringify({ ideas: [{ title: 'Idea', unknown: 'FORBIDDEN' }], decisions: ['Decision'], plan: ['Step'], screens: [], brand: { name: 'Live', colors: [] }, ignored: 'FORBIDDEN' }));
  const queried: string[] = [];
  const frame = await macSnapshot(configureMac(f.home), { isAlive: () => true, run: async (_bin, args, cwd) => {
    queried.push(cwd!); return args[0] === 'rev-parse' ? cwd! : `worktree ${cwd}\0branch refs/heads/main\0`;
  } });
  assert.equal(frame.projects.length, 1); const row = frame.projects[0];
  assert.equal(row.project.name, 'Live'); assert.equal(row.agents.length, 1); assert.equal(row.agents[0].task, 'Live-work');
  assert.deepEqual(row.project.needs?.items, ['Live-needs']);
  assert.deepEqual(row.project.leadStatus, { status: 'busy', updatedAt: now });
  assert.deepEqual(row.project.departmentLeads[0].leadStatus, { status: 'idle', updatedAt: now });
  assert.equal(row.draft?.ideas[0].title, 'Idea'); assert.deepEqual(row.draft?.decisions, ['Decision']);
  assert.ok(queried.every(p => p === projects.Live.path));
  assert.doesNotMatch(JSON.stringify(frame), /Hidden|Archived|Remote|FORBIDDEN|cwd|pid|socketPath|PRIVATE NAME|Live-app|design-app|bridgeSessionId/);
  const sources = [{ mac: true as const, floorId: '', computerName: 'Mini', observedAt: now, projects: [row.project], agents: row.agents }];
  const leads = projectLeads([row.project], sources, [], false);
  assert.equal(leads[0].leadStatus?.status, 'busy'); assert.equal(leads[0].working, 1); assert.equal(leads[1].leadStatus?.status, 'idle');
  assert.doesNotMatch(JSON.stringify({ projects: publicProjects([row.project], false), leads }), /Live-lead|design-id|Live-needs|\/Users|sessionId/);
});
