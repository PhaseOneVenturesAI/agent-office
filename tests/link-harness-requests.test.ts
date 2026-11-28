import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { officeRequestsCommand, processOfficeRequests } from '../src/server/link/harness-requests.js';
import { requestStatuses } from '../src/server/link/project-requests.js';
import { requestsDir } from '../src/server/link/project-registry.js';

test('the harness processor runs as one fixed command with no shell, and never fails the action', async () => {
  const calls: unknown[][] = [];
  const fake = (code: 'exit' | 'error' | 'hang') => (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]); let fn: (() => void) | undefined; let killed = false;
    if (code !== 'hang') setTimeout(() => fn?.(), 5);
    return { kill: () => { killed = true; }, on: (e: string, f: () => void) => { if ((code === 'exit' && e === 'exit') || (code === 'error' && e === 'error')) fn = f; }, get killed() { return killed; } };
  };
  await processOfficeRequests('/Users/someone', fake('exit'));
  assert.deepEqual(calls[0], ['/Users/someone/Documents/GitHub/AgentHarness/bin/agent-harness', 'office-requests']);
  assert.deepEqual(officeRequestsCommand('/h'), ['/h/Documents/GitHub/AgentHarness/bin/agent-harness', 'office-requests']);
  await processOfficeRequests('/h', fake('error'));
  const started = Date.now(); await processOfficeRequests('/h', fake('hang'), 50); assert.ok(Date.now() - started < 1000, 'a hung harness is cut off at the timeout');
  await processOfficeRequests('/h', () => { throw Error('spawn failed'); });
  await processOfficeRequests(path.resolve('.paradev/no-such-home')); // real spawn of a missing command resolves too
});

test('request status follows the file as the harness moves it to done/ or rejected/', t => {
  mkdirSync('.paradev', { recursive: true }); const home = mkdtempSync(path.resolve('.paradev/requests-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = requestsDir(home); mkdirSync(path.join(dir, 'done'), { recursive: true }); mkdirSync(path.join(dir, 'rejected'));
  const write = (id: string, project: string, at: string) => writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ schema: 1, kind: 'new-project', id, createdAt: at, project, folder: project, repoUrl: null, leadSessionId: null, source: 'office-link' }));
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  write(a, 'Alpha', '2026-11-28T01:00:00Z'); write(b, 'Beta', '2026-11-28T01:00:00Z');
  assert.deepEqual(requestStatuses(home).map(r => r.status), ['Waiting for harness registration', 'Waiting for harness registration']);
  renameSync(path.join(dir, a + '.json'), path.join(dir, 'done', a + '.json'));
  renameSync(path.join(dir, b + '.json'), path.join(dir, 'rejected', b + '.json'));
  assert.deepEqual(Object.fromEntries(requestStatuses(home).map(r => [r.project, r.status])), { Alpha: 'Registered on this Mac', Beta: 'The harness refused to register it' });
});
