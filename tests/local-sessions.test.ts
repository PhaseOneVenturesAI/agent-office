import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Nodes } from '../src/server/nodes.js';
import { collectParadev, addMapping } from '../src/server/local-sessions/paradev.js';
import { readSnapshot } from '../src/server/local-sessions/schema.js';
import { localObservation } from '../src/shared/protocol/local-sessions.js';

const now = Date.now();
const row = { floorId: 'floor-a', workspaceId: 'workspace-a', terminalId: 'terminal-a', provider: 'claude' as const, state: 'starting' as const, lastEventAt: now - 9 * 3600_000, exited: false };
const snapshot = { observedAt: now, collection: 'ok' as const, sessions: [row] };

test('collector uses only mapped workspaces and read-only commands; reconstructs a private allowlist', async () => {
  const calls: string[][] = [];
  const secret = 'SECRET transcript /Users/private/project';
  const result = await collectParadev('/paradev', new Map([['workspace-a', 'floor-a']]), async (_bin, args) => {
    calls.push(args);
    if (args[0] === 'workspaces') return [{ id: 'workspace-a', name: secret, worktreePath: secret }, { id: 'unmapped', name: secret }];
    if (args[0] === 'terminals') return { sessions: [{ terminalId: 'terminal-a', workspaceId: 'workspace-a', createdAt: now - 9 * 3600_000, exited: false, exitCode: 0, attached: true, title: secret, customTitle: secret }] };
    return { agentId: 'claude', state: 'starting', lastEventAt: row.lastEventAt, because: secret, details: [secret], owner: 'invented' };
  }, () => now);
  assert.deepEqual(result, snapshot);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(calls, [
    ['workspaces', 'list', '--local', '--json'],
    ['terminals', 'list', '--local', '--workspace', 'workspace-a', '--json'],
    ['agents', 'explain', '--local', '--workspace', 'workspace-a', '--terminal', 'terminal-a', '--json'],
  ]);
  assert.match(localObservation(result.sessions[0], result, true, now), /^Stale/);
});

test('unsupported terminal shapes and cross-workspace rows become partial, never leak observations into a mapped project', async () => {
  for (const terminals of [[{ terminalId: 'terminal-a' }], { sessions: [{ terminalId: 'terminal-a', workspaceId: 'other-workspace' }] }]) {
    const result = await collectParadev('/paradev', new Map([['workspace-a', 'floor-a']]), async (_bin, args) => {
      if (args[0] === 'workspaces') return [{ id: 'workspace-a' }];
      if (args[0] === 'terminals') return terminals;
      assert.fail('unmapped/malformed rows must never be explained');
    }, () => now);
    assert.deepEqual(result, { observedAt: now, collection: 'partial', sessions: [] });
  }
});

test('installed Paradev states survive collector and schema; blocked stays visible and exited never implies completion', async () => {
  for (const state of ['starting', 'working', 'blocked', 'idle', 'exited', 'unsupported-state']) {
    const result = await collectParadev('/paradev', new Map([['workspace-a', 'floor-a']]), async (_bin, args) => {
      if (args[0] === 'workspaces') return [{ id: 'workspace-a' }];
      if (args[0] === 'terminals') return { sessions: [{ terminalId: 'terminal-a', workspaceId: 'workspace-a', exited: false }] };
      return { agentId: 'claude', state, lastEventAt: now, owner: 'unproven' };
    }, () => now);
    const session = result.sessions[0];
    assert.equal(result.collection, 'ok');
    assert.equal(session.state, state === 'unsupported-state' ? 'unknown' : state);
    assert.equal('owner' in session, false, 'a native state does not establish ownership');
    if (state === 'blocked') assert.equal(localObservation(session, result, true, now), 'Recently observed · blocked');
    if (state === 'exited') {
      assert.equal(localObservation(session, result, true, now), 'Exited · outcome unknown');
      assert.equal(localObservation(session, result, false, now), 'Stale observation · last reported exited · outcome unknown');
    }
  }
  for (const unsupported of ['running', 'waiting', 'stopped', 'error']) {
    assert.equal(readSnapshot({ ...snapshot, sessions: [{ ...row, state: unsupported }] }, now), undefined);
  }
});

test('schema drops unknown keys and rejects malformed, future, repeated and oversized snapshots', () => {
  assert.deepEqual(readSnapshot({ ...snapshot, token: 'secret', sessions: [{ ...row, prompt: 'secret', nodeId: 'other' }] }, now), snapshot);
  assert.equal(readSnapshot({ ...snapshot, observedAt: now + 60_000 }, now), undefined);
  assert.equal(readSnapshot({ ...snapshot, sessions: [{ ...row, lastEventAt: now + 60_000 }] }, now), undefined);
  assert.equal(readSnapshot({ ...snapshot, sessions: [{ ...row, workspaceId: '/Users/private' }] }, now), undefined);
  assert.equal(readSnapshot({ ...snapshot, sessions: [row, row] }, now), undefined);
  assert.equal(readSnapshot({ ...snapshot, sessions: Array(101).fill(row) }, now), undefined);
  assert.equal(readSnapshot(null, now), undefined);
  const m = new Map<string, string>();
  addMapping(m, 'workspace-a=floor-a');
  assert.throws(() => addMapping(m, 'workspace-a=floor-b'));
  assert.throws(() => addMapping(m, '/Users/private=floor-b'));
});

test('collection failures expose no stderr or fake success, and timestamps govern presence separately', async () => {
  const result = await collectParadev('/paradev', new Map([['workspace-a', 'floor-a']]), async () => { throw new Error('token=secret'); }, () => now);
  assert.deepEqual(result, { observedAt: now, collection: 'unavailable', sessions: [] });
  const fresh = { ...row, lastEventAt: now };
  assert.match(localObservation(fresh, snapshot, false, now), /^Stale/);
  assert.match(localObservation(fresh, { ...snapshot, observedAt: now - 100_000 }, true, now), /^Stale/);
  assert.match(localObservation({ ...fresh, lastEventAt: null }, snapshot, true, now), /^Stale/);
  assert.match(localObservation({ ...fresh, exited: true }, snapshot, true, now), /outcome unknown/);
});

function socket() {
  const handlers = new Map<string, ((...a: any[]) => void)[]>();
  return { closed: 0, on(k: string, fn: (...a: any[]) => void) { handlers.set(k, [...handlers.get(k) ?? [], fn]); }, close(code = 1000) { this.closed = code; }, emit(k: string, ...a: any[]) { handlers.get(k)?.forEach((fn) => fn(...a)); } };
}
const hello = { t: 'hello', host: 'test-host', platform: 'test', cpus: 1, memGB: 1, providers: [] };
function send(s: ReturnType<typeof socket>, v: unknown) { s.emit('message', Buffer.from(JSON.stringify(v))); }

test('node authentication precedes snapshot refresh; replacement, floor filtering and revocation isolate observations', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-nodes-'));
  const nodes = new Nodes(dir, () => {});
  try {
    const invite = nodes.invite(), old = socket(), next = socket();
    nodes.attach(old as any, invite.token);
    send(old, { t: 'local.snapshot', snapshot });
    assert.equal(nodes.state('floor-a').nodes[0].localSessions, undefined);
    send(old, hello); send(old, { t: 'local.snapshot', snapshot });
    assert.deepEqual(nodes.state('floor-a').nodes[0].localSessions, snapshot);
    assert.equal(nodes.state().nodes[0].localSessions, undefined);
    assert.deepEqual(nodes.state('floor-b').nodes[0].localSessions?.sessions, []);
    nodes.attach(next as any, invite.token);
    assert.equal(old.closed, 4002);
    send(next, hello); old.emit('close');
    send(old, { t: 'local.snapshot', snapshot: { ...snapshot, observedAt: now + 1, sessions: [] } });
    assert.equal(nodes.state('floor-a').nodes[0].localSessions?.sessions.length, 1);
    send(next, { t: 'local.snapshot', snapshot: { ...snapshot, observedAt: now - 1, sessions: [] } });
    assert.equal(nodes.state('floor-a').nodes[0].localSessions?.sessions.length, 1);
    assert.equal(nodes.state('floor-a').nodes[0].online, true);
    nodes.revoke(invite.id);
    send(next, { t: 'local.snapshot', snapshot });
    assert.deepEqual(nodes.state('floor-a'), { nodes: [] });
    const other = nodes.invite();
    assert.equal(nodes.state('floor-a').nodes[0].localSessions, undefined);
    assert.notEqual(invite.token, other.token);
  } finally { nodes.close(); rmSync(dir, { recursive: true, force: true }); }
});
