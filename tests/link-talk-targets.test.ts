import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveTarget, liveSession } from '../src/server/link/targets.js';
import { macEntries } from '../src/server/hq/local/snapshot.js';
import { sessionStatuses } from '../src/server/hq/local/sessions.js';
import { fixture, session, appSession } from './support/link-talk.js';

test('main, department and cofounder target the snapshot identities in its exact cleaned order', t => {
  const f = fixture(t), design = '22345678-1234-1234-1234-123456789abc';
  const projects = { One: { path: f.project, leadSessionId: session, leadAppSession: appSession,
    departmentLeads: { Skip: null, Design: { title: 'Design lead', sessionId: design, appSession: 'design-app' }, Marketing: { department: 'Marketing', title: 'Marketing lead', appSession: 'marketing-app' } } } };
  f.registry(projects, { leadSessionId: design, leadAppSession: 'cofounder-app' });
  assert.equal(resolveTarget(f.config, { project: 'One' }).sessionId, session);
  const entries = macEntries({ projects });
  assert.deepEqual(entries[0].departments.map(d => d.ids), [[design, 'design-app'], [undefined, 'marketing-app']]);
  assert.equal(resolveTarget(f.config, { project: 'One', department: 0 }).sessionId, design);
  assert.equal(resolveTarget(f.config, { project: 'One', department: 1 }).appSession, 'marketing-app');
  assert.throws(() => resolveTarget(f.config, { project: 'One', department: 2 }), /not registered/);
  assert.equal(resolveTarget(f.config, { cofounder: true }).sessionId, design);
  f.registry(projects);
  assert.throws(() => resolveTarget(f.config, { cofounder: true }), /Cofounder isn't registered on this Mac/);
});

test('hidden, archived, remote-only and missing paths cannot be delivery targets', t => {
  const f = fixture(t);
  for (const flags of [{ office: 'hidden' }, { localState: 'archived' }, { localState: 'remote-only' }, { path: '/missing/link-talk-project' }]) {
    f.registry({ One: { path: f.project, leadSessionId: session, ...flags } });
    assert.throws(() => resolveTarget(f.config, { project: 'One' }), /not available/);
  }
});

test('live lookup shares session registry caps and matches native, bridge and host identities', t => {
  const f = fixture(t), target = resolveTarget(f.config, { project: 'One' });
  const file = path.join(f.sessions, `${process.pid}.json`);
  for (const identity of ['sessionId', 'bridgeSessionId', 'hostSessionId']) {
    const r = { pid: process.pid, status: 'idle', updatedAt: Date.now(), sessionId: 'other', [identity]: identity === 'sessionId' ? session : appSession };
    writeFileSync(file, JSON.stringify(r));
    assert.equal(liveSession(f.home, target)?.pid, process.pid);
    assert.equal(sessionStatuses(f.home)([session, appSession]).status, 'idle');
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, sessionId: session, status: 'busy', updatedAt: Date.now() }));
  assert.equal(liveSession(f.home, target)?.status, 'busy');
  assert.equal(liveSession(f.home, target, () => false), undefined);
  writeFileSync(file, 'x'.repeat(16 * 1024 + 1));
  assert.throws(() => liveSession(f.home, target), /Cannot read/);
  assert.equal(sessionStatuses(f.home)([session]).status, 'unknown');
});
