import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cleanProjects } from '../src/shared/protocol/hq.js';
import { activityLine, cleanHQActivity, HELPER_TTL_MS, workTargetKey } from '../src/shared/protocol/live-work.js';
import { activityTarget } from '../src/server/link/live-targets.js';
import { LiveActivity } from '../src/server/link/live.js';
import { presence } from '../src/server/cubbies/local/presence.js';
import { livePresence } from '../src/server/cubbies/local/presence-live.js';
import { activityOffice } from './support/hq-activity.js';
import { MacConnector } from '../src/server/hq/local/connector.js';
import { configureMac } from '../src/server/hq/local/config.js';
import { macSignature } from '../src/server/hq/wire.js';
import { cubbyKey } from '../src/server/cubbies/wire.js';
import type { Activity } from '../src/server/link/activity.js';

function directory(t: any) {
  mkdirSync('.paradev', { recursive: true });
  const dir = realpathSync(mkdtempSync(path.resolve('.paradev/activity-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
function timer() {
  let now = 0, seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return { now: () => now, after(fn: () => void, ms: number) { const id = ++seq; pending.set(id, { at: now + ms, fn }); return () => { pending.delete(id); }; },
    advance(ms: number) { const end = now + ms; for (;;) { const next = [...pending].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break; pending.delete(next[0]); now = next[1].at; next[1].fn(); } now = end; }, pending };
}
const sessionId = '11111111-1111-4111-8111-111111111111';
const event = (event: string, extra = {}): Activity => ({ schema: 1, event, sessionId, ...extra });

test('summary forms: basename only, command first word only, simple test detection, other tools and empty inputs', () => {
  for (const [input, expected] of [
    ['Edit hero.tsx', 'editing hero.tsx'], ['Write: /Users/private/page.tsx', 'editing page.tsx'], ['NotebookEdit book.ipynb', 'editing book.ipynb'],
    ['Read C:\\private\\readme.md', 'reading readme.md'], ['Bash git secret-arguments', 'running git'], ['Bash npm test --token=secret', 'running tests'],
    ['Bash node tests/check.mjs', 'running tests'], ['Bash pytest', 'running tests'], ['Bash python -m pytest', 'running tests'],
    ['Bash npm build', 'running npm'], ['Grep some private text', 'using Grep'], ['Agent researcher', 'using Agent'], ['Edit', 'using Edit'],
  ]) assert.equal(activityLine(input), expected, input);
  assert.equal(activityLine('hero.tsx', 'Edit'), 'editing hero.tsx');
  assert.equal(activityLine(null), undefined);
  assert.equal(activityLine(`Read ${sessionId}`), 'using Read');
});

test('registry matches visible main, department and Cofounder only; paths and event project cannot authorize sessions', t => {
  const home = directory(t), project = path.join(home, 'repo'), sessions = path.join(home, '.claude/sessions');
  mkdirSync(project); mkdirSync(sessions, { recursive: true });
  const projectsFile = path.join(home, 'projects.json');
  const ids = [sessionId, '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  const registry = { cofounder: { leadAppSession: 'co-app' }, projects: {
    Plimbo: { path: project, leadAppSession: 'main-app', departmentLeads: [{ department: 'Design', title: 'Design lead', sessionId: ids[1] }] },
    Hidden: { path: project, leadSessionId: ids[3], office: 'hidden' },
    Archived: { path: project, leadSessionId: ids[3], localState: 'archived' },
    Remote: { path: project, leadSessionId: ids[3], localState: 'remote-only' },
  } };
  writeFileSync(projectsFile, JSON.stringify(registry));
  ids.forEach((id, i) => writeFileSync(path.join(sessions, `${i}.json`), JSON.stringify({ sessionId: id, bridgeSessionId: ['main-app', 'design-app', 'co-app', 'hidden-app'][i], status: 'busy', updatedAt: Date.now(), pid: i + 10 })));
  const config = { home, projectsFile } as any;
  assert.deepEqual(activityTarget(config, event('PreToolUse'), () => true), { project: 'Plimbo' });
  assert.deepEqual(activityTarget(config, event('Stop', { sessionId: ids[1], appSession: 'design-app' }), () => true), { project: 'Plimbo', department: 0 });
  assert.deepEqual(activityTarget(config, event('PreToolUse', { sessionId: ids[2] }), () => true), { cofounder: true });
  for (const input of [{ sessionId: ids[3], project: 'Plimbo', cwd: project }, { sessionId: 'other', appSession: 'main-app' }, { appSession: 'hidden-app' }]) assert.equal(activityTarget(config, event('PreToolUse', input), () => true), undefined);
  assert.equal(activityTarget(config, event('PreToolUse'), () => false), undefined);
  registry.projects.Hidden.office = 'visible'; registry.projects.Hidden.leadSessionId = sessionId;
  writeFileSync(projectsFile, JSON.stringify(registry));
  assert.equal(activityTarget(config, event('PreToolUse'), () => true), undefined, 'ambiguous sessions are dropped');
});

test('activity coalesces latest per lead per second, hashes helpers, caps, removes, expires and resets them', () => {
  const clock = timer(), sent: { at: number; frame: any }[] = [];
  const live = new LiveActivity(() => ({ project: 'Plimbo' }), f => sent.push({ at: clock.now(), frame: f }), clock);
  live.activity(event('PreToolUse', { summary: 'Read /Users/private/one.ts', cwd: '/private', reply: 'PRIVATE', agentId: 'secret-agent' }));
  live.activity(event('PreToolUse', { summary: 'Edit hero.tsx' })); live.activity(event('PreToolUse', { summary: 'Write final.ts' }));
  assert.equal(sent.length, 1); clock.advance(1000); assert.equal(sent.at(-1)!.frame.doing, 'editing final.ts');
  for (let i = 0; i < 10; i++) live.activity(event('SubagentStart', { agentId: `private-${i}`, agentType: 'Research helper' }));
  clock.advance(1000); assert.equal(sent.at(-1)!.frame.helpers.length, 8);
  live.activity(event('SubagentStop', { agentId: 'private-0' })); clock.advance(1000); assert.equal(sent.at(-1)!.frame.helpers.length, 7);
  clock.advance(HELPER_TTL_MS); assert.equal(sent.at(-1)!.frame.helpers.length, 0);
  // A turn ending (Stop) clears the tool line but keeps background sub-agents; a new session clears both.
  live.activity(event('SubagentStart', { agentId: 'background' })); live.activity(event('PreToolUse', { tool: 'Edit', summary: 'Edit a.ts' })); clock.advance(1000);
  live.activity(event('Stop')); clock.advance(1000);
  assert.equal(sent.at(-1)!.frame.doing, undefined); assert.equal(sent.at(-1)!.frame.helpers.length, 1);
  live.activity(event('SubagentStop', { agentId: 'background' })); clock.advance(1000); assert.deepEqual(sent.at(-1)!.frame.helpers, []);
  live.activity(event('SubagentStart', { agentId: 'new' })); clock.advance(1000);
  assert.equal(sent.at(-1)!.frame.helpers[0].title, 'Helper');
  live.activity(event('SessionStart')); clock.advance(1000);
  assert.equal(sent.at(-1)!.frame.doing, undefined); assert.deepEqual(sent.at(-1)!.frame.helpers, []);
  assert.ok(sent.every((s, i) => !i || s.at - sent[i - 1].at >= 1000));
  assert.doesNotMatch(JSON.stringify(sent), /private|PRIVATE|sessionId|agentId|cwd|reply|Users/);
  live.close(); assert.equal(clock.pending.size, 0);
  const drop = new LiveActivity(() => undefined, () => assert.fail('not a lead'), clock); drop.activity(event('Stop')); drop.close();
});

test('work frame whitelist rejects malformed, paths, raw ids, duplicates, oversized helper sets and injected fields', () => {
  const frame = { t: 'hq.activity', target: { project: 'Plimbo', cwd: '/private' }, doing: 'editing hero.tsx', helpers: [{ id: 'a'.repeat(32), title: 'Helper /Users/private', kind: 'subagent', agentId: 'private' }], sessionId, reply: 'private', cwd: '/private' };
  const clean = cleanHQActivity(frame)!;
  assert.equal(clean.helpers[0].title, 'Helper'); assert.doesNotMatch(JSON.stringify(clean), /private|sessionId|agentId|cwd|reply/);
  assert.equal(cleanHQActivity({ ...frame, target: { project: '/private' } }), undefined);
  assert.equal(cleanHQActivity({ ...frame, helpers: [frame.helpers[0], frame.helpers[0]] }), undefined);
  assert.equal(cleanHQActivity({ ...frame, helpers: Array(9).fill(frame.helpers[0]) }), undefined);
  assert.equal(cleanHQActivity({ ...frame, helpers: [{ ...frame.helpers[0], id: sessionId }] }), undefined);
  assert.equal(cleanHQActivity({ ...frame, doing: 'running /Users/private' })?.doing, undefined);
  assert.notEqual(workTargetKey({ project: 'Plimbo' }), workTargetKey({ project: 'Plimbo', department: 0 }));
});

test('presence checks pid start time, retains idle workers, one factory per run, cleaned progress and opaque ids', t => {
  const dir = directory(t), started = 'Fri Nov 27 10:20:30 2026';
  assert.equal(livePresence({ pid: 42, pidStartedAt: started }, () => true, () => started), true);
  assert.equal(livePresence({ pid: 42, pidStartedAt: started }, () => true, () => 'different process'), false);
  assert.equal(livePresence({ pid: 42, pidStartedAt: started }, () => true, () => undefined), false);
  assert.equal(livePresence({ pid: 42 }, () => true), true);
  assert.equal(livePresence({ pid: 42 }, () => false), false);
  for (const [i, kind, status, lastTool] of [[42, 'factory', 'busy', 'Bash npm test --secret'], [43, 'worker', 'idle', 'Edit stale.ts'], [44, 'factory', 'running', 'Read /private/input.ts']] as const) {
    writeFileSync(path.join(dir, `${i}-abcdef.json`), JSON.stringify({ schema: 1, pid: i, pidStartedAt: started, folder: dir, title: `Run ${i}`, provider: 'codex', role: 'builder', kind, status, lastTool, updatedAt: Date.now() }));
  }
  const rows = presence([dir], dir, () => true, () => started).map(r => r.agent);
  assert.equal(rows.length, 3); assert.deepEqual(rows.map(a => a.kind), ['factory', 'worker', 'factory']);
  assert.equal(rows[0].role, 'factory'); assert.equal(rows[0].lastTool, 'running tests'); assert.equal(rows[1].status, 'idle'); assert.equal(rows[1].lastTool, undefined); assert.equal(rows[2].lastTool, 'reading input.ts');
  assert.ok(rows.every(a => /^harness:[a-f0-9]{32}$/.test(a.id))); assert.equal(new Set(rows.map(a => a.id)).size, 3);
  assert.doesNotMatch(JSON.stringify(rows), /private|secret|pidStartedAt|folder/);
  assert.equal(presence([dir], dir, () => true, () => 'reused').length, 0);
});

test('actual node admission, owner/manager/coworker projections, stale fallback, disconnect and revoke', t => {
  let now = Date.now(); const f = activityOffice(directory(t), () => now); t.after(f.close);
  const activity = { t: 'hq.activity', target: { project: 'Plimbo' }, doing: 'editing hero.tsx', helpers: [{ id: 'b'.repeat(32), title: 'Research helper', kind: 'subagent' }] };
  f.link.frame(activity); assert.equal(f.mac.work.get(f.node, activity.target), undefined);
  f.admit(); f.snapshot();
  f.mac.accept(f.node, 'coworker', activity); assert.equal(f.mac.work.get(f.node, activity.target), undefined);
  assert.equal(f.mac.accept('uninvited', 'owner', activity), false);
  f.link.frame({ ...activity, target: { project: 'Hidden' } }); assert.equal(f.mac.work.get(f.node, { project: 'Hidden' }), undefined);
  f.link.frame(activity);
  for (const role of ['owner', 'manager']) {
    const view = f.hqView(role)!, main = view.leads!.find(l => l.role === 'CEO')!;
    assert.equal(main.doing, 'editing hero.tsx'); assert.deepEqual(main.helpers!.map(h => h.kind).sort(), ['factory', 'subagent', 'worker']);
    assert.ok(view.projects[0].workers!.some(w => w.doing === 'editing hero.tsx'));
    assert.equal(f.talkView(role)!.leads.find(l => l.role === 'CEO')!.doing, 'editing hero.tsx');
    assert.doesNotMatch(JSON.stringify(main), /private-|sessionId|agentId/);
  }
  assert.equal(f.hqView('coworker'), undefined);
  assert.equal(f.talkView('owner', 'plimbo')!.leads.find(l => l.role === 'CEO')!.doing, 'editing hero.tsx');
  for (const role of ['manager', 'coworker']) {
    const view = f.talkView(role, 'plimbo')!;
    assert.ok(view.leads.find(l => l.role === 'CEO')!.helpers!.length);
    assert.doesNotMatch(JSON.stringify(view), /"doing"|hero.tsx|layout.tsx|running tests|private-/);
  }
  now += 120_001; f.snapshot(); f.mac.refresh();
  const stale = f.hqView()!.leads!.find(l => l.role === 'CEO')!;
  assert.equal(stale.doing, undefined); assert.equal(stale.leadStatus!.status, 'idle'); assert.equal(stale.helpers!.length, 2);
  f.link.frame(activity); f.link.close(); f.mac.refresh();
  assert.equal(f.mac.work.get(f.node, activity.target), undefined);
  f.mac.revoke('owner', f.node); assert.equal(f.mac.work.get(f.node, activity.target), undefined);
});

test('connector sends activity only after signed admission, and stops sending on disconnect', async t => {
  const home = directory(t); mkdirSync(path.join(home, 'Documents/GitHub/AgentHarness'), { recursive: true });
  writeFileSync(path.join(home, 'Documents/GitHub/AgentHarness/projects.json'), '{"projects":{}}');
  const config = configureMac(home), sent: any[] = [], token = 'test';
  const connector = new MacConnector(config, token, async () => ({ t: 'hq.snapshot', computerId: config.computerId, observedAt: Date.now(), projects: [] })); t.after(() => connector.close());
  const frame = { t: 'hq.activity' as const, target: { cofounder: true as const }, helpers: [] };
  connector.connected(f => { sent.push(f); }); assert.equal(connector.sendActivity(frame), false);
  const ready = { t: 'hq.ready' as const, computerId: config.computerId, owner: 'owner', floor: 'hq', connection: 'fresh' };
  connector.receive(JSON.stringify({ ...ready, signature: macSignature(cubbyKey(token), ready) }));
  await Promise.resolve(); connector.sendActivity(frame); assert.equal(sent.at(-1).t, 'hq.activity');
  connector.disconnected(); assert.equal(connector.sendActivity(frame), false);
});


test('quiet helpers survive heartbeats while stale doing fades; queued targets are revalidated', () => {
  const clock = timer(), sent: any[] = [];
  let visible = true;
  const live = new LiveActivity(() => visible ? { project: 'Plimbo' } : undefined, f => sent.push(f), clock);
  live.activity(event('PreToolUse', { summary: 'Edit hero.tsx' }));
  live.activity(event('SubagentStart', { agentId: 'helper' })); clock.advance(1000);
  clock.advance(120_000);
  assert.equal(sent.at(-1).doing, undefined); assert.equal(sent.at(-1).helpers.length, 1);
  clock.advance(HELPER_TTL_MS - 121_000); assert.equal(sent.at(-1).helpers.length, 0);
  live.activity(event('PreToolUse', { summary: 'Edit one.ts' }));
  const count = sent.length;
  live.activity(event('PreToolUse', { summary: 'Edit two.ts' })); visible = false; clock.advance(1000);
  assert.equal(sent.length, count); live.close();
});

test('each lead has an independent throttle and closing cancels queued output', () => {
  const clock = timer(), sent: any[] = [];
  const live = new LiveActivity(e => ({ project: e.sessionId === sessionId ? 'One' : 'Two' }), f => sent.push(f), clock);
  live.activity(event('PreToolUse', { project: 'One', summary: 'Read first.ts' }));
  live.activity(event('PreToolUse', { sessionId: '22222222-2222-4222-8222-222222222222', summary: 'Read second.ts' }));
  assert.equal(sent.length, 2);
  live.activity(event('PreToolUse', { project: 'One', summary: 'Edit third.ts' }));
  live.close(); clock.advance(1000); assert.equal(sent.length, 2);
});

test('task board cleaner retains doing and factory kind while rejecting non-display commands', () => {
  const projects = cleanProjects([{ name: 'Plimbo', hasMainLead: true, departmentLeads: [], workers: [
    { id: 'activity:abc', title: 'Main lead', doing: 'editing hero.tsx' },
    { id: 'factory:abc', title: 'Factory', kind: 'factory', doing: 'running tests', status: 'working' },
    { id: 'unsafe', title: 'Worker', doing: 'running npm test --secret /Users/private' },
  ] }]);
  assert.equal(projects[0].workers![0].doing, 'editing hero.tsx');
  assert.equal(projects[0].workers![1].kind, 'factory');
  assert.equal(projects[0].workers![1].doing, 'running tests');
  assert.equal(projects[0].workers![2].doing, undefined);
});
