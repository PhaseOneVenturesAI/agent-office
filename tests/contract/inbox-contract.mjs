#!/usr/bin/env -S node --import tsx
// Manual only: node --import tsx tests/contract/inbox-contract.mjs <trusted-project-dir>
// Runs a throwaway Haiku session on the local subscription. Never part of npm test.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startLeadTalk } from '../../src/server/link/talk.ts';
import { nativeEnv } from '../../src/server/cubbies/local/io.ts';
import { liveSession, resolveTarget } from '../../src/server/link/targets.ts';

const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
if (process.platform !== 'darwin' || process.argv.length !== 3) throw Error('Run on the linked Mac: node --import tsx tests/contract/inbox-contract.mjs <trusted-project-dir>');
const project = realpathSync(process.argv[2]), home = os.homedir();
const directory = mkdtempSync(path.join(os.tmpdir(), 'office-inbox-contract-'));
const sessionId = randomUUID(), name = `office-contract-${randomUUID().slice(0, 8)}`;
const projectsFile = path.join(directory, 'projects.json'), hook = path.join(directory, 'office-activity.cjs'), settings = path.join(directory, 'settings.json');
const config = { home, projectsFile, state: directory, computerId: randomUUID() };
let link, attempted = false;
try {
  const harness = path.join(home, 'Documents/GitHub/AgentHarness');
  const { stdout } = await run('git', ['-C', harness, 'show', 'bf5d53b:hooks/office-activity.cjs'], { maxBuffer: 256 * 1024 });
  writeFileSync(hook, stdout, { mode: 0o600 });
  writeFileSync(projectsFile, JSON.stringify({ projects: { Contract: { path: project, leadSessionId: sessionId } } }), { mode: 0o600 });
  writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(hook)}` }] }] } }), { mode: 0o600 });
  const frames = [];
  link = await startLeadTalk(config, f => frames.push(f), { stateDirectory: directory });
  const env = { ...nativeEnv(), AGENT_HARNESS_STATE: directory, AGENT_HARNESS_PROJECTS: projectsFile };
  const auth = JSON.parse((await run('claude', ['auth', 'status', '--json'], { cwd: project, env, timeout: 5000 })).stdout);
  assert.ok(auth.loggedIn === true && auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty', 'contract requires native subscription sign-in');
  attempted = true;
  await run('claude', ['--bg', '--model', 'haiku', '-n', name, '--session-id', sessionId, '--settings', settings], { cwd: project, env, timeout: 60_000, maxBuffer: 256 * 1024 });
  const target = resolveTarget(config, { project: 'Contract' });
  const readyUntil = Date.now() + 60_000;
  while (!liveSession(home, target) && Date.now() < readyUntil) await sleep(500);
  assert.ok(liveSession(home, target), 'throwaway background Claude did not register; do not substitute headless');
  const id = randomUUID();
  // Fake office: the real link's receive/send boundary, no office connection or credentials.
  link.talk.receive({ t: 'lead.send', id, target: { project: 'Contract' }, from: 'Office contract', text: 'reply with exactly: pong' });
  const until = Date.now() + 180_000;
  while (!frames.some(f => f.id === id && (f.t === 'lead.reply' || f.state === 'failed')) && Date.now() < until) await sleep(100);
  assert.ok(frames.some(f => f.id === id && f.t === 'lead.state' && f.state === 'delivered' && f.path === 'inbox'), 'expected inbox delivered');
  assert.match(frames.find(f => f.id === id && f.t === 'lead.reply')?.text ?? '', /pong/i, 'expected hook reply containing pong');
  console.log('PASS: real inbox delivered; harness Stop hook returned pong.');
} finally {
  await link?.close();
  if (attempted) {
    for (const command of ['stop', 'rm']) {
      try { await run('claude', [command, sessionId], { cwd: project, timeout: 30_000, maxBuffer: 256 * 1024 }); }
      catch { console.error(`Cleanup failed: run claude ${command} ${sessionId} locally.`); process.exitCode = 1; }
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
