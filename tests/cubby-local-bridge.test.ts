import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeLead, NOT_LISTENING, bridgeDirs, listening, waitForMessage, writeReply } from '../src/server/cubbies/local/bridge.js';
import { cubbyRole, presence } from '../src/server/cubbies/local/presence.js';
import { wakeSummary } from '../src/server/cubbies/local/wake.js';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { cubbyKey, relaySignature } from '../src/server/cubbies/wire.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
import type { CubbyAgent, CubbyNodeFrame } from '../src/shared/protocol/cubbies.js';

const tmp = (name: string) => realpathSync(mkdtempSync(path.join(os.tmpdir(), name)));

test('harness presence records become builders, reviewers and factory runs, only for live runs in the project', () => {
  const dir = tmp('cubby-runs-');
  const repo = tmp('cubby-repo-');
  const tree = path.join(repo, 'tree');
  mkdirSync(tree);
  const rec = (pid: number, extra: object) => writeFileSync(path.join(dir, `${pid}-abcd1234.json`),
    JSON.stringify({ schema: 1, kind: 'worker', provider: 'codex', role: 'builder', title: 'Hall geometry', folder: tree, branch: 'feat/x', pid, readOnly: false, ...extra }));
  rec(101, {});
  rec(102, { provider: 'claude-phase-one', role: 'reviewer', readOnly: true, title: 'Review step 1' });
  rec(103, { kind: 'factory', role: 'factory', provider: 'kimi' });
  rec(104, { folder: '/elsewhere' });
  rec(105, {}); // dead
  writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  const found = presence([repo, tree], dir, (pid) => pid !== 105);
  assert.deepEqual(found.map((p) => [p.pid, p.agent.role, p.agent.tool, p.agent.task]), [
    [101, 'builder', 'codex', 'Hall geometry'],
    [102, 'reviewer', 'claude', 'Review step 1'],
    [103, 'factory', 'kimi', 'Hall geometry'],
  ]);
  assert.equal(cubbyRole('researcher', true, 'worker'), 'reviewer');
  assert.equal(cubbyRole('designer', false, 'worker'), 'builder');
  assert.deepEqual(presence([repo], path.join(dir, 'missing')), []);
});

test('the bridge hands a verified message to the waiting lead session and returns its answer', async () => {
  const state = tmp('cubby-bridge-');
  const lead = new BridgeLead(state, Date.now, 10);
  await assert.rejects(lead.send('hello', new AbortController().signal), (e: Error) => e.message === NOT_LISTENING);
  assert.ok(!existsSync(bridgeDirs(state).inbox) || !readdirSync(bridgeDirs(state).inbox).length, 'nothing is queued while nobody listens');
  const waiting = waitForMessage(state, 5_000, undefined, 10);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(listening(state));
  const answer = lead.send('How is step 1?', new AbortController().signal);
  const m = await waiting;
  assert.equal(m?.text, 'How is step 1?');
  assert.throws(() => writeReply(state, '../x', 'no'));
  writeReply(state, m!.requestId, 'Hall is in, keys next.');
  assert.equal(await answer, 'Hall is in, keys next.');
  assert.equal(existsSync(path.join(bridgeDirs(state).claimed, `${m!.requestId}.json`)), false, 'cleaned up after the answer');
  assert.throws(() => writeReply(state, m!.requestId, 'late'), /no longer waiting/);
});

test('a message nobody claims is taken back once the lead stops listening, and cancel stops the wait', async () => {
  const state = tmp('cubby-bridge-');
  let now = Date.now();
  mkdirSync(bridgeDirs(state).root, { recursive: true });
  writeFileSync(bridgeDirs(state).listening, JSON.stringify({ pid: process.pid, at: now, between: true }));
  const lead = new BridgeLead(state, () => now, 5);
  const sent = lead.send('anyone?', new AbortController().signal);
  now += 61_000;
  await assert.rejects(sent, (e: Error) => e.message === NOT_LISTENING);
  assert.deepEqual(readdirSync(bridgeDirs(state).inbox), []);
  now = Date.now();
  writeFileSync(bridgeDirs(state).listening, JSON.stringify({ pid: process.pid, at: now }));
  const abort = new AbortController();
  const pending = lead.send('cancel me', abort.signal);
  abort.abort();
  await assert.rejects(pending, /cancelled/);
});

const agent = (id: string, task: string, status: CubbyAgent['status'] = 'working'): CubbyAgent => ({ id, tool: 'codex', role: 'builder', task, branch: '', status });

test('the wake summary says who finished, started and needs you, and stays quiet after a short blip', () => {
  const at = 1_800_000_000_000;
  const before = { at, agents: [agent('a', 'Hall'), agent('b', 'Keys'), { ...agent('l', 'Lead'), role: 'lead' as const }] };
  assert.equal(wakeSummary(before, [], at + 60_000), undefined);
  const text = wakeSummary(before, [agent('b', 'Keys', 'needs-you'), agent('c', 'Wake')], at + 45 * 60_000, 3)!;
  assert.match(text, /^Back after 45 min away\./);
  assert.match(text, /finished: Hall \(codex\)/);
  assert.match(text, /started: Wake \(codex\)/);
  assert.match(text, /needs you: Keys \(codex\)/);
  assert.match(text, /3 new commits/);
  assert.doesNotMatch(text, /Lead/);
  assert.match(wakeSummary(before, before.agents, at + 3 * 3_600_000, 0)!, /Back after 3 h away\. 2 still working\./);
});

test('the connector sends the wake summary once, on the first snapshot after it is bound again', async (t) => {
  const now = 1_800_000_000_000;
  const config: LocalConfig = { floor: 'floor', project: '/repo', roots: ['/repo'], branches: new Map(), state: '/unused',
    computerId: 'computer', provider: 'claude', session: 'session', executable: 'claude', claudeHome: '/unused', fresh: false };
  const sent: CubbyNodeFrame[] = [];
  const connector = new CubbyConnector(config, 'token', {
    now: () => now, release: () => {}, head: async () => undefined, commits: async () => undefined,
    seen: () => ({ at: now - 30 * 60_000, agents: [agent('a', 'Hall')] }),
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents: [agent('c', 'Wake')], plan: [], needsYou: [], observedAt: now }),
    lead: { busy: false, send: async () => 'ok', stop: async () => {} },
  });
  t.after(() => connector.close());
  connector.connected((f) => sent.push(f));
  const binding = { cubbyId: 'cubby', floorId: 'floor', ownerId: 'owner', connectionId: 'c1' };
  const ready = { t: 'cubby.ready', ...binding };
  connector.receive(JSON.stringify({ ...ready, signature: relaySignature(cubbyKey('token'), ready as never) }));
  await new Promise((r) => setTimeout(r, 20));
  const snaps = sent.filter((f): f is Extract<CubbyNodeFrame, { t: 'cubby.snapshot' }> => f.t === 'cubby.snapshot');
  assert.equal(snaps.length, 1);
  assert.match(snaps[0].wake ?? '', /Back after 30 min away\. finished: Hall \(codex\); started: Wake \(codex\)\./);
});
