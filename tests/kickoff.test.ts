import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import { Drafts } from '../src/server/drafts/index.js';
import { createOrgRemote, kickoffRemote, runKickoff, type KickoffRunner } from '../src/server/drafts/remote.js';
import { Nodes } from '../src/server/nodes.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { floorHelpers } from '../src/server/office/floors.js';
import { messaging } from '../src/server/office/messaging.js';
import { draftsHandlers, draftsView } from '../src/server/ws/handlers/drafts.js';
import { cubbiesChanged } from '../src/server/ws/handlers/cubbies.js';
import type { Ctx } from '../src/server/office/context.js';
import { NEW_BADGE_MS } from '../src/shared/protocol/drafts.js';

function socket() {
  const events = new Map<string, Function[]>();
  return { readyState: 1, bufferedAmount: 0, sent: [] as any[],
    on(e: string, fn: Function) { events.set(e, [...events.get(e) ?? [], fn]); },
    send(raw: string) { this.sent.push(JSON.parse(raw)); },
    frame(frame: unknown) { for (const fn of events.get('message') ?? []) fn(Buffer.from(JSON.stringify(frame))); },
    close() { this.readyState = 3; for (const fn of events.get('close') ?? []) fn(); },
  };
}
const localOnly: KickoffRunner = (command, args, cwd) => {
  assert.equal(command, 'git', 'tests must never execute gh');
  return runKickoff(command, args, cwd);
};
function fixture(t: any, options: { disabled?: boolean; run?: KickoffRunner } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-kickoff-')), remote = path.join(dir, 'remotes');
  const env = options.disabled ? {} : { AGENT_OFFICE_KICKOFF_REMOTE: remote };
  const building = new Building(dir, dir);
  const names: Record<string, string> = { alice: 'Alice', bob: 'Bob' };
  const drafts = new Drafts(dir, true, 'Alice', id => names[id], building, env, options.run ?? localOnly);
  const ctx = { building, drafts, floors: new Map(), clients: new Map() } as unknown as Ctx;
  Object.assign(ctx, messaging(ctx), floorHelpers(ctx));
  const nodes = new Nodes(dir, () => ctx.cubbies?.refresh());
  ctx.cubbies = new Cubbies(dir, true, nodes, id => names[id], id => ctx.floors.has(id), () => cubbiesChanged(ctx), Date.now,
    id => building.list().find(d => d.id === id)?.draft ? drafts.records.rows.get(id)?.owner ?? '' : undefined);
  const def = drafts.create('New Project', 'alice');
  const floor: any = { id: def.id, def, project: {}, info: () => ({ id: def.id, name: def.name, repo: def.repo }) };
  ctx.floors.set(def.id, floor);
  const client = (accountId: string) => {
    const c: any = { id: accountId, accountId, ws: socket(), peer: { id: accountId, name: names[accountId] } };
    ctx.clients.set(c.id, c); return c;
  };
  const alice = client('alice'), bob = client('bob'); alice.peer.floor = def.id;
  const kickoff = (c = alice, confirm = def.name) => draftsHandlers['drafts.kickoff'](ctx, c, { t: 'drafts.kickoff', floorId: def.id, confirm });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: def.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  t.after(() => { ctx.cancelFloorsChanged(); nodes.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, remote, env, building, drafts, ctx, nodes, def, floor, alice, bob, kickoff, git };
}
function publish(f: ReturnType<typeof fixture>) {
  const setup = f.ctx.cubbies.setup(f.def.id, 'alice', 0, 'Nova', {} as any), ws = socket();
  f.nodes.attach(ws as any, setup.token);
  ws.frame({ t: 'hello', host: 'private', providers: [] });
  ws.frame({ t: 'cubby.hello', floorId: f.def.id, computerId: 'computer-alice', computerName: 'Mac mini' });
  ws.frame({ t: 'cubby.snapshot', floorId: f.def.id, observedAt: Date.now(), agents: [], plan: [], needsYou: [], draft: {
    decisions: ['Use local subscriptions', '$(touch NEVER_EXECUTED) ../outside'], plan: ['Review the first screen'],
    screens: [{ title: 'Settings', status: 'review' }, { title: 'Welcome', status: 'approved' }, { title: 'Later', status: 'sketch' }],
    brand: { name: 'Project Brand', tagline: 'A short promise', colors: ['#aabbcc'] },
  } });
  ws.close(); // Kickoff uses the last boards even while the owner's computer sleeps.
  return setup;
}

test('kickoff commits and pushes boards, opens the same floor/cubby, persists launch and announces to everyone', async t => {
  const f = fixture(t), setup = publish(f), before = f.git('rev-parse', 'HEAD');
  assert.equal(f.ctx.floorVisible(f.def.id, f.bob), false);
  assert.equal(draftsView(f.ctx, f.floor, f.alice).canKickoff, true);
  await f.kickoff(f.alice, '  NEW PROJECT  ');
  assert.equal(f.alice.ws.sent.find((m: any) => m.t === 'drafts.kickoffFailed'), undefined);
  assert.equal(f.def.draft, undefined);
  assert.equal(f.def.repo, undefined);
  assert.notEqual(f.git('rev-parse', 'HEAD'), before);
  assert.equal(f.git('log', '-1', '--format=%an <%ae>'), 'Agent Office <office@localhost>');
  assert.deepEqual(f.git('ls-tree', '-r', '--name-only', 'HEAD').split('\n'), ['README.md', 'design/SCREENS.md', 'design/system.md', 'design/tokens.json', 'docs/BRIEF.md', 'docs/FEEDBACK.md', 'docs/PLAN.md']);
  const read = (file: string) => readFileSync(path.join(f.def.dir, file), 'utf8');
  assert.equal(read('README.md'), '# New Project\n\nA short promise\n');
  assert.match(read('docs/BRIEF.md'), /\$\(touch NEVER_EXECUTED\) \.\.\/outside/);
  assert.equal(existsSync(path.join(f.def.dir, 'NEVER_EXECUTED')), false);
  assert.match(read('docs/PLAN.md'), /Review the first screen/);
  assert.match(read('design/system.md'), /Name: Project Brand[\s\S]*Tagline: A short promise[\s\S]*#aabbcc/);
  assert.match(read('design/SCREENS.md'), /Welcome — approved\n- Settings — review\n- Later — sketch/);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
  assert.equal(f.git('--git-dir', path.join(f.remote, 'new-project.git'), 'log', '-1', '--format=%H', 'main'), f.git('rev-parse', 'HEAD'));
  assert.equal(f.ctx.floorVisible(f.def.id, f.bob), true);
  assert.equal(f.ctx.floorInfos(f.bob)[0].isNew, true);
  const launched = draftsView(f.ctx, f.floor, f.bob).launched!;
  assert.deepEqual(launched.screens, ['Welcome']);
  assert.equal(launched.brand.name, 'Project Brand');
  assert.equal(draftsView(f.ctx, f.floor, f.alice).here, undefined);
  assert.equal(f.drafts.isNew(f.def.id, launched.at + NEW_BADGE_MS - 1), true);
  assert.equal(f.drafts.isNew(f.def.id, launched.at + NEW_BADGE_MS), false);
  const cubby = f.ctx.cubbies.state(f.def.id, 'alice').cubbies[0];
  assert.equal(cubby.id, setup.id); assert.equal(cubby.slot, 0);
  assert.equal(f.ctx.cubbies.state(f.def.id, 'bob').cubbies[0].interior, undefined);
  for (const c of [f.alice, f.bob]) {
    assert.deepEqual(c.ws.sent.find((m: any) => m.t === 'drafts.kicked'), { t: 'drafts.kicked', floorId: f.def.id, name: 'New Project', by: 'Alice' });
    assert.ok(c.ws.sent.some((m: any) => m.t === 'toast' && m.text === 'New Project is open.'));
  }
  assert.ok(f.alice.ws.sent.some((m: any) => m.t === 'gong' && m.why === 'merged'));
  assert.ok(!f.bob.ws.sent.some((m: any) => m.t === 'gong'));
  f.bob.peer.floor = f.def.id; cubbiesChanged(f.ctx);
  assert.deepEqual(f.bob.ws.sent.findLast((m: any) => m.t === 'drafts').state.launched, launched);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(f.bob.ws.sent.findLast((m: any) => m.t === 'floors').floors[0].isNew, true);
  const building = new Building(f.dir, f.dir);
  assert.equal(building.list()[0].draft, undefined);
  const restored = new Drafts(f.dir, true, '', id => id, building, {});
  assert.deepEqual(restored.state(f.def.id, 'bob', f.ctx.cubbies).launched, launched);
  assert.deepEqual(new Drafts(f.dir, false, '', id => id, building, {}).state(f.def.id, 'bob', f.ctx.cubbies).launched, launched);
  assert.equal(restored.records.rows.get(f.def.id)?.kickedOffAt, launched.at);
  await f.kickoff();
  assert.equal(f.alice.ws.sent.at(-1).error, 'No such floor');
  assert.equal(f.git('rev-list', '--count', 'HEAD'), '2');
});

test('wrong confirmation and another account are refused without changing files or announcing', async t => {
  const f = fixture(t), head = f.git('rev-parse', 'HEAD');
  await f.kickoff(f.bob);
  assert.equal(f.bob.ws.sent.at(-1).error, 'No such floor');
  await f.kickoff(f.alice, 'wrong');
  assert.match(f.alice.ws.sent.at(-1).error, /Type the project name/);
  assert.equal(f.def.draft, true); assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(existsSync(f.remote), false); assert.equal(f.git('status', '--porcelain'), '');
});

test('no remote configuration disables kickoff and refuses without changes', async t => {
  const f = fixture(t, { disabled: true });
  assert.equal(draftsView(f.ctx, f.floor, f.alice).canKickoff, false);
  await f.kickoff();
  assert.match(f.alice.ws.sent.at(-1).error, /not switched on/);
  assert.equal(f.def.draft, true); assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(existsSync(path.join(f.def.dir, 'README.md')), false);
  assert.equal(kickoffRemote({ AGENT_OFFICE_KICKOFF_REMOTE: 'relative', AGENT_OFFICE_KICKOFF_ORG: 'PhaseOneVenturesAI' }), undefined);
  assert.equal(kickoffRemote({ AGENT_OFFICE_KICKOFF_ORG: '../bad' }), undefined);
});

test('a real local push failure restores files, commit, config and metadata and removes only the half-made remote', async t => {
  let fail = true;
  const f = fixture(t, { run: (cmd, args, cwd) => localOnly(cmd,
    fail && args.includes('push') ? args.map(a => a === 'origin' ? path.join(cwd, 'missing-remote.git') : a) : args, cwd) });
  const head = f.git('rev-parse', 'HEAD'), config = readFileSync(path.join(f.def.dir, '.git/config'), 'utf8');
  await f.kickoff();
  assert.match(f.alice.ws.sent.at(-1).error, /create or push/);
  assert.equal(f.def.draft, true); assert.equal(f.ctx.floorVisible(f.def.id, f.bob), false);
  assert.equal(f.drafts.records.rows.get(f.def.id)?.launched, undefined);
  assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('remote'), ''); assert.equal(readFileSync(path.join(f.def.dir, '.git/config'), 'utf8'), config);
  assert.equal(existsSync(path.join(f.def.dir, 'docs')), false);
  assert.equal(existsSync(path.join(f.remote, 'new-project.git')), false);
  assert.equal(f.bob.ws.sent.some((m: any) => m.t === 'drafts.kicked'), false);
  fail = false; await f.kickoff(); assert.equal(f.def.draft, undefined);
});

test('duplicate kickoff and floor removal cannot overlap an in-flight kickoff', async t => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const f = fixture(t, { run: async (cmd, args, cwd) => {
    if (args.includes('push')) { entered(); await gate; }
    return localOnly(cmd, args, cwd);
  } });
  const first = f.kickoff(); await started;
  await f.kickoff(); assert.match(f.alice.ws.sent.at(-1).error, /already in progress/);
  assert.match((await f.ctx.closeFloor(f.floor, 'Alice'))!, /Wait for kickoff/);
  release(); await first;
  assert.equal(f.git('rev-list', '--count', 'HEAD'), '2');
  assert.equal(f.bob.ws.sent.filter((m: any) => m.t === 'drafts.kicked').length, 1);
});

test('org mode builds exact private creation argv using a recorder, never a process runner', async () => {
  const remote = kickoffRemote({ AGENT_OFFICE_KICKOFF_ORG: 'PhaseOneVenturesAI' });
  assert.equal(remote?.kind, 'org');
  const calls: unknown[] = [];
  const repo = await createOrgRemote(remote as { kind: 'org'; org: string }, 'new-project', '/draft-folder', async (...call) => { calls.push(call); return ''; });
  assert.equal(repo, 'PhaseOneVenturesAI/new-project');
  assert.deepEqual(calls, [['gh', ['repo', 'create', 'PhaseOneVenturesAI/new-project', '--private', '--source', '.', '--push'], '/draft-folder']]);
});

test('existing remote directories and symlinked document folders are left untouched', async t => {
  const f = fixture(t), target = path.join(f.remote, 'new-project.git');
  mkdirSync(target, { recursive: true }); writeFileSync(path.join(target, 'keep'), 'existing');
  await f.kickoff();
  assert.equal(readFileSync(path.join(target, 'keep'), 'utf8'), 'existing');
  assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
  const outside = path.join(f.dir, 'outside'); mkdirSync(outside);
  symlinkSync(outside, path.join(f.def.dir, 'docs'));
  await f.kickoff(); assert.match(f.alice.ws.sent.at(-1).error, /prepare the draft/);
  assert.equal(existsSync(path.join(outside, 'BRIEF.md')), false);
});

test('a floor persistence failure rolls back the successful local push and launch record', async t => {
  const f = fixture(t), launch = f.building.launchDraft.bind(f.building);
  f.building.launchDraft = () => { throw Error('disk full'); };
  await f.kickoff();
  assert.match(f.alice.ws.sent.at(-1).error, /save kickoff/);
  assert.equal(f.def.draft, true); assert.equal(f.git('rev-list', '--count', 'HEAD'), '1');
  assert.equal(existsSync(path.join(f.remote, 'new-project.git')), false);
  assert.equal(new Drafts(f.dir, true, '', id => id, new Building(f.dir, f.dir), {}).records.rows.get(f.def.id)?.launched, undefined);
  f.building.launchDraft = launch;
  await f.kickoff(); assert.equal(f.def.draft, undefined);
});

test('binary document rollback restores exact bytes and permissions, removing only new folders', async t => {
  const { documentTransaction } = await import('../src/server/drafts/documents.js');
  const { statSync, chmodSync } = await import('node:fs');
  const f = fixture(t), root = path.join(f.def.dir, 'design/screens'); mkdirSync(root, { recursive: true });
  const existing = path.join(root, 'approved.png'), bytes = Buffer.from([0, 255, 128, 1]);
  writeFileSync(existing, bytes); chmodSync(existing, 0o640);
  const tx = documentTransaction(f.def.dir, { 'design/screens/approved.png': Buffer.from([1, 2]), 'docs/FEEDBACK.md': 'notes', 'design/system.md': 'design' });
  tx.write(); tx.restore();
  assert.deepEqual(readFileSync(existing), bytes); assert.equal(statSync(existing).mode & 0o777, 0o640);
  assert.equal(existsSync(root), true); assert.equal(existsSync(path.join(f.def.dir, 'docs')), false);
  assert.equal(existsSync(path.join(f.def.dir, 'design/system.md')), false);
  rmSync(root, { recursive: true });
  const outside = path.join(f.dir, 'outside'); mkdirSync(outside); symlinkSync(outside, root);
  assert.throws(() => documentTransaction(f.def.dir, { 'design/screens/approved.png': bytes }), /regular directory/);
  rmSync(root); writeFileSync(root, 'not a folder');
  assert.throws(() => documentTransaction(f.def.dir, { 'design/screens/approved.png': bytes }), /regular directory/);
});

test('an owner taken off the project starters can no longer kick off', async t => {
  const f = fixture(t), head = f.git('rev-parse', 'HEAD');
  (f.drafts as any).starters = new Set();
  await f.kickoff(f.alice);
  assert.match(f.alice.ws.sent.at(-1).error, /Only designated project starters/);
  assert.equal(f.def.draft, true); assert.equal(f.git('rev-parse', 'HEAD'), head); assert.equal(existsSync(f.remote), false);
});
