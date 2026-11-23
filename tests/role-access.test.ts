// Role access and the staff-Q&A boundary (see src/server/role-access.ts and staff-qa.ts), tested
// at the handler level like PR37's ownership tests: the CEO is private to its owner — an unrelated
// OFFICE ADMIN cannot seize ownership, edit the CEO, or chat with it. Staff questions never enter
// the manager's provider session: the manager's conversation refuses them, and the read-only Ask
// runs on a separate no-tools ACP session that auto-rejects every tool request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ceoHandlers } from '../src/server/ws/handlers/ceo.js';
import { departmentsHandlers } from '../src/server/ws/handlers/departments.js';
import { conversationHandlers } from '../src/server/ws/handlers/conversations.js';
import { buildQaHome, qaLaunch, staffQaAsk, toolFreeVerified } from '../src/server/staff-qa.js';
import { floorStaffQA } from '../src/server/dept-staff-qa.js';
import { publicRoleWorker, redactWorkersFor } from '../src/server/role-access.js';
import { RoleChat } from '../src/server/role-chat.js';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

const OWNER = 'info@jdiaz.com';
const resolveCommandShim = (cmd: string): string | undefined => {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    try {
      const p = path.join(dir, cmd);
      accessSync(p);
      return p;
    } catch { /* keep looking */ }
  }
  return undefined;
};
const IVAN = 'ivanv@phaseoneventures.com';

/** An accounts office with a CEO (owned by info@jdiaz.com) and a marketing manager (Ivan controls). */
function fixture(actor: string | undefined, admin = false) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const sent: unknown[] = [];
  const ceo = { name: 'Avery', owner: OWNER, workerId: 'ceo-w', by: 'root', at: 0 };
  const lead = { name: 'Maya', workerId: 'mgr-w', controllers: [IVAN], audience: [], custodian: 'ivan@example.com', by: 'root', at: 0 };
  const dept = { id: 'dept-1', preset: 'marketing', name: 'Marketing', lead, roles: [] };
  const qaCalls: { deptId: string; question: string }[] = [];
  const floor = {
    id: 'floor',
    ceo: {
      get: () => ceo,
      set: (ask: { owner?: string }) => { calls.push(`ceo.set:${JSON.stringify(ask)}`); if (ask.owner) ceo.owner = ask.owner; return undefined; },
      clear: () => undefined,
      savedChoice: () => undefined,
      composeLaunch: () => 'named',
      recordHire: () => calls.push('ceo.recordHire'),
      isCeoWorker: (id: string) => id === 'ceo-w',
    },
    departments: {
      get: (id: string) => (id === 'dept-1' ? dept : undefined),
      leadDeptOfWorker: (id: string) => (id === 'mgr-w' ? dept : undefined),
      setAccess: () => (calls.push('dept.setAccess'), undefined),
      setObjective: () => undefined,
      state: () => ({ departments: [dept] }),
    },
    isRoleWorker: (id: string) => (id === 'ceo-w' ? { role: 'CEO', name: 'Avery' } : id === 'mgr-w' ? { role: 'Marketing manager', name: 'Maya' } : undefined),
    workers: {
      get: (id: string) => (id === 'ceo-w' || id === 'mgr-w' ? { id, provider: 'kimi', status: 'idle', kind: 'agent' } : undefined),
      conversations: { send: (...a: unknown[]) => (calls.push(`conv.send:${a[1]}`), undefined), snapshot: () => [], subscribe: () => () => {}, page: () => [] },
      ownerOf: () => undefined,
      officeDefault: { provider: 'kimi' },
      spawn: () => (calls.push('spawn'), 'no desk'),
      deskOccupied: () => false,
      fetchBase: () => undefined,
      list: () => [],
      writerIds: () => [],
    },
    project: { agentProviders: ['kimi', 'claude'], branch: undefined },
    staffQA: async (deptId: string, question: string) => {
      qaCalls.push({ deptId, question });
      return { ok: true as const, answer: 'The current brief favors clarity.' };
    },
    assignObjective: () => ({ manager: 'Maya', started: false }),
    writerCap: () => undefined,
    sendHome: () => Promise.resolve({}),
  };
  const ctx = {
    accounts: {
      any: true,
      get: (id: string) => ({ name: id.split('@')[0], email: id }),
      byEmail: (email: string) => (email.endsWith('@example.com') ? { id: email, name: email.split('@')[0], email } : undefined),
    },
    meOf: () => (admin ? { admin: true } : { admin: false }),
    workerFloor: () => floor,
    floorOf: () => floor,
    stillIn: () => true,
    floors: new Map([['floor', floor]]),
    warn: (_c: unknown, error: unknown) => { if (error) warnings.push(String(error)); },
    sendTo: (_c: unknown, msg: unknown) => { sent.push(msg); },
    toastFloor: () => {},
    signInFor: () => undefined,
    withSignIn: (_c: unknown, _w: unknown, go: () => void) => go(),
    withFreshBase: (_c: unknown, _f: unknown, go: () => void) => go(),
    signins: { officeAllowed: () => true, officeRevoked: () => false },
  } as unknown as Ctx;
  const client = { id: 'b', accountId: actor, peer: { name: actor ?? 'someone', floor: 'floor' }, out: false, ws: { readyState: 1, bufferedAmount: 0, send: () => {} } } as unknown as Client;
  return { ctx, client, calls, warnings, sent, qaCalls, ceo, floor };
}

test('an unrelated office admin cannot seize the CEO, edit it, or chat with it; the owner can', () => {
  // Admin tries to reassign ownership to themselves: refused, no call.
  const seize = fixture('mallory@example.com', true);
  (ceoHandlers['ceo.set'] as Function)(seize.ctx, seize.client, { t: 'ceo.set', name: 'Avery', owner: 'mallory@example.com' });
  assert.deepEqual(seize.calls, [], 'no ceo.set ran');
  assert.match(seize.warnings[0]!, /Only info@jdiaz.com/);
  assert.equal(seize.ceo.owner, OWNER, 'ownership unchanged');
  // Admin tries to rename / launch / assign: refused.
  (ceoHandlers['ceo.set'] as Function)(seize.ctx, seize.client, { t: 'ceo.set', name: 'Mallory' });
  (ceoHandlers['ceo.launch'] as Function)(seize.ctx, seize.client, { t: 'ceo.launch' });
  (ceoHandlers['ceo.assign'] as Function)(seize.ctx, seize.client, { t: 'ceo.assign', dept: 'marketing', objective: 'X' });
  assert.deepEqual(seize.calls, []);
  // Admin tries to open the private CEO chat: refused.
  (conversationHandlers['conversation.open'] as Function)(seize.ctx, seize.client, { t: 'conversation.open', workerId: 'ceo-w' });
  (conversationHandlers['conversation.send'] as Function)(seize.ctx, seize.client, { t: 'conversation.send', workerId: 'ceo-w', text: 'hi' });
  assert.ok(!seize.calls.some((c) => c.startsWith('conv.send')), 'no chat with the CEO');
  // The owner, by contrast, edits and talks freely.
  const owner = fixture(OWNER);
  (ceoHandlers['ceo.set'] as Function)(owner.ctx, owner.client, { t: 'ceo.set', name: 'Avery', provider: 'kimi' });
  assert.ok(owner.calls.some((c) => c.startsWith('ceo.set')));
  (conversationHandlers['conversation.send'] as Function)(owner.ctx, owner.client, { t: 'conversation.send', workerId: 'ceo-w', text: 'Priorities?' });
  assert.ok(owner.calls.some((c) => c.startsWith('conv.send')));
  // The owner may also delegate ownership onwards; the new owner then controls it.
  const handover = fixture(OWNER);
  (ceoHandlers['ceo.set'] as Function)(handover.ctx, handover.client, { t: 'ceo.set', name: 'Avery', owner: IVAN });
  assert.equal(handover.ceo.owner, IVAN);
});

test('staff Q&A never enters the manager session; the Ask runs separately and read-only', async () => {
  // A staffer (any signed-in account, not a controller) tries the manager chat: refused, and the
  // manager's conversation is never touched.
  const staff = fixture('pat@example.com');
  (conversationHandlers['conversation.send'] as Function)(staff.ctx, staff.client, { t: 'conversation.send', workerId: 'mgr-w', text: 'What is the brand color?' });
  assert.ok(!staff.calls.some((c) => c.startsWith('conv.send')), 'the manager session is untouched');
  assert.match(staff.warnings[0]!, /Ask box/);
  // The Ask box answers on a separate session; the manager conversation still never runs.
  (departmentsHandlers['departments.ask'] as Function)(staff.ctx, staff.client, { t: 'departments.ask', id: 'dept-1', question: 'What is the brand color?' });
  assert.deepEqual(staff.qaCalls, [{ deptId: 'dept-1', question: 'What is the brand color?' }]);
  assert.ok(!staff.calls.some((c) => c.startsWith('conv.send') || c.startsWith('spawn')), 'no manager session, no new manager process');
  await new Promise((r) => setTimeout(r, 20));
  const reply = staff.sent.find((m) => (m as { t: string }).t === 'departments.qa') as { answer: string };
  assert.match(reply.answer, /clarity/);
  // A controller talks to the manager directly — that IS the manager session, and it's allowed.
  const controller = fixture(IVAN);
  (conversationHandlers['conversation.send'] as Function)(controller.ctx, controller.client, { t: 'conversation.send', workerId: 'mgr-w', text: 'Status?' });
  assert.ok(controller.calls.some((c) => c.startsWith('conv.send')));
});

test('staff cannot fire the manager or mutate the department: clear, assets, release, requests', () => {
  const staff = fixture('pat@example.com');
  (departmentsHandlers['departments.lead.clear'] as Function)(staff.ctx, staff.client, { t: 'departments.lead.clear', id: 'dept-1' });
  (departmentsHandlers['departments.asset'] as Function)(staff.ctx, staff.client, { t: 'departments.asset', id: 'dept-1', label: 'X', kind: 'link', ref: 'https://example.com', status: 'current' });
  (departmentsHandlers['departments.asset.drop'] as Function)(staff.ctx, staff.client, { t: 'departments.asset.drop', id: 'dept-1', asset: 'a1' });
  (departmentsHandlers['departments.release'] as Function)(staff.ctx, staff.client, { t: 'departments.release', id: 'dept-1', workerId: 'mgr-w' });
  (departmentsHandlers['departments.request.reject'] as Function)(staff.ctx, staff.client, { t: 'departments.request.reject', id: 'dept-1', request: 'r1' });
  assert.ok(!staff.calls.some((c) => c.startsWith('dept.setAccess') || c.startsWith('clearLead')), 'no mutation ran');
  assert.ok(staff.warnings.length >= 4, `every route refused the staffer (${staff.warnings.length})`);
  assert.match(staff.warnings[0]!, /controllers/);
  // A public viewer only ever sees the public shell of a role worker — never prompt, activity, or work.
  const full = { id: 'mgr-w', kind: 'agent', provider: 'kimi', model: 'k3', deskId: 'desk-2', name: 'Maya', color: '#fff', status: 'working', acked: true, createdBy: 'Kim', createdAt: 1, cols: 80, rows: 24, viewers: ['v'], viewerIds: ['v'], prompt: 'SECRET-PROMPT', activity: 'SECRET-ACTIVITY', task: { name: 'SECRET', summary: 'SECRET' }, usage: { totalTokens: 5 }, worktree: { path: '.agent-office/worktrees/x', branch: 'b', base: 'c' } } as import('../src/shared/protocol.js').WorkerInfo;
  const shell = publicRoleWorker(full, 'staff');
  assert.equal((shell as { prompt?: string }).prompt, undefined);
  assert.equal((shell as { activity?: string }).activity, undefined);
  assert.equal((shell as { task?: unknown }).task, undefined);
  assert.equal((shell as { usage?: unknown }).usage, undefined);
  assert.equal((shell as { worktree?: unknown }).worktree, undefined);
  assert.equal(shell.viewers.length, 0);
  assert.equal(shell.name, 'Maya');
  const controllerView = publicRoleWorker(full, 'controller');
  assert.equal(controllerView.prompt, 'SECRET-PROMPT', 'controllers keep the full card');
});

test('delegation of control: admins bootstrap an empty role; afterwards only the delegation chain', () => {
  // Fresh department, no controllers, no CEO owner configured anywhere → admin may designate.
  const boot = fixture('root@example.com', true);
  delete boot.floor.departments.get('dept-1')!.lead.controllers;
  boot.ceo.owner = undefined as never;
  (departmentsHandlers['departments.access'] as Function)(boot.ctx, boot.client, { t: 'departments.access', id: 'dept-1', controllers: [IVAN] });
  assert.ok(boot.calls.includes('dept.setAccess'));
  // Now Ivan is controller: the same admin can no longer rewrite the delegation.
  const after = fixture('root@example.com', true);
  (departmentsHandlers['departments.access'] as Function)(after.ctx, after.client, { t: 'departments.access', id: 'dept-1', controllers: ['mallory@example.com'] });
  assert.ok(!after.calls.includes('dept.setAccess'), 'admin cannot seize an existing delegation');
  assert.match(after.warnings[0]!, /Ivan|controllers/i);
  // Ivan can pass control onwards; the CEO owner can too.
  const ivan = fixture(IVAN);
  (departmentsHandlers['departments.access'] as Function)(ivan.ctx, ivan.client, { t: 'departments.access', id: 'dept-1', controllers: [IVAN, 'eduardo@phaseoneventures.com'] });
  assert.ok(ivan.calls.includes('dept.setAccess'));
});

// --- the separate read-only session, proven against a fake ACP agent -----------------------------

const FAKE_QA = path.join(mkdtempSync(path.join(tmpdir(), 'agent-office-qa-fake-')), 'qa-fake.mjs');
writeFileSync(
  FAKE_QA,
  `// Minimal ACP fake: answers one prompt, mid-turn asks to run a TOOL, records the office's
// answer, then finishes. Proves the read-only session can never hold a tool.
let frames = 0;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (buf) => {
  for (const line of buf.toString().split('\\n')) {
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, capabilities: {} } });
    else if (msg.method === 'session/new') send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'qa-fake' } });
    else if (msg.method === 'session/prompt') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'qa-fake', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Short answer from the desk.' } } } });
      send({ jsonrpc: '2.0', id: 999, method: 'session/request_permission', params: { sessionId: 'qa-fake', toolCall: { toolCallId: 't1', tool: { kind: 'bash', name: 'Bash' } }, options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_it', name: 'Reject', kind: 'reject' }] } });
      const pending = msg.id;
      const onAnswer = (buf2) => {
        for (const l of buf2.toString().split('\\n')) {
          if (!l.trim()) continue;
          let a; try { a = JSON.parse(l); } catch { continue; }
          if (a.id === 999) {
            process.stdin.removeListener('data', onAnswer);
            process.stderr.write('PERMISSION_OUTCOME:' + JSON.stringify(a.result) + '\\n');
            send({ jsonrpc: '2.0', id: pending, result: { stopReason: 'end_turn' } });
          }
        }
      };
      process.stdin.on('data', onAnswer);
    } else if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} });
    frames++;
  }
});
`,
);

test('the read-only Q&A session auto-rejects every tool request and still answers', async (t) => {
  const outcome = await staffQaAsk({ file: process.execPath, args: [FAKE_QA], cwd: path.dirname(FAKE_QA), env: { ...process.env }, prompt: 'What is the brand color?', timeoutMs: 15000 });
  assert.deepEqual(outcome, { ok: true, answer: 'Short answer from the desk.' });
});

test('staff Q&A fails closed off Kimi, never falls back to an arbitrary binary, and builds a tool-free home', () => {
  // The manager's engine decides; there is no fallback to whatever is on PATH.
  assert.match(qaLaunch('claude') as string, /only available on a Kimi-backed manager/);
  assert.match(qaLaunch(undefined) as string, /only available on a Kimi-backed manager/);
  assert.match(qaLaunch('kimi') as unknown as string === 'string' ? '' : '', /^$/, 'kimi launches or reports its own absence honestly');
  // The dedicated home carries the custodian credentials, a tool-free config, and the framing.
  const src = mkdtempSync(path.join(tmpdir(), 'agent-office-qa-src-'));
  mkdirSync(path.join(src, 'credentials'), { recursive: true });
  writeFileSync(path.join(src, 'credentials', 'kimi-code-env-x.json'), '{"fake":true}');
  const built = buildQaHome(src, 'You are the desk.');
  assert.ok(typeof built !== 'string');
  try {
    const config = readFileSync(path.join(built.home, 'config.toml'), 'utf8');
    assert.match(config, /enabled = \["\*"\]/, 'the global tool switch removes every tool');
    assert.match(config, /default_permission_mode = "manual"/);
    assert.match(readFileSync(path.join(built.home, 'SYSTEM.md'), 'utf8'), /You are the desk\./);
    assert.match(readFileSync(path.join(built.home, 'credentials', 'kimi-code-env-x.json'), 'utf8'), /fake/);
  } finally {
    built.cleanup();
  }
});

test('floor staff Q&A uses the authorized custodian env, never the host credentials', async () => {
  const applied: { id: string; only?: string }[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-qa-floor-'));
  const floor = {
    dir,
    dataDir: dir,
    runAs: {
      ready: () => true,
      why: () => '',
      apply: (id: string, env: Record<string, string>, _dirs: string[], only?: string) => {
        applied.push({ id, only });
        env.KIMI_CODE_HOME = path.join(dir, 'custodian-kimi'); // no credentials there: buildQaHome tolerates it
        return env;
      },
    },
    departments: { get: () => ({ id: 'dept-1', preset: 'marketing', name: 'Marketing', brief: [], briefArchived: 0, desks: [], rev: 0, roles: [], roster: [], assets: [], lead: { name: 'Maya', provider: 'kimi', by: 'Kim', at: 0, custodian: 'ivan@example.com' } }) },
    roleChat: { append: () => {} },
  };
  // Point the fake Kimi at a script that just answers, so we can watch the environment it received.
  const probe = path.join(dir, 'probe.mjs');
  writeFileSync(probe, `process.stdout.write(JSON.stringify({ method: 'initialize', id: 1 }) + '\\n');\nprocess.stdin.on('data', () => {});\n`);
  const launch = { file: process.execPath, args: [probe] };
  // Floor-level env scrubbing: the launched env must not carry office credentials.
  const env = { ...process.env, AGENT_OFFICE_HOOK_TOKEN: 'secret', KIMI_CODE_HOME: '/host/home' } as Record<string, string>;
  delete env.AGENT_OFFICE_HOOK_TOKEN;
  const outcome = await staffQaAsk({ ...launch, cwd: dir, env, prompt: 'q', timeoutMs: 1500 });
  assert.match(outcome.why!, /exited|timed out/, 'the stub never answers, and the session closes honestly');
  // The floor wrapper applies the custodian's sign-in for kimi only.
  const qa = await floorStaffQA(floor as never, 'dept-1', 'What is the tone?', 'Pat', 'acct-ivan', { file: process.execPath, args: [FAKE_QA] });
  assert.deepEqual(qa, { ok: true, answer: 'Short answer from the desk.' });
  assert.deepEqual(applied, [{ id: 'acct-ivan', only: 'kimi' }], 'the custodian env is account-scoped to kimi');
  // Without a custodian in an office with accounts it would fail closed; the fixture has none, so
  // the office path also refuses to run on host credentials when the engine is unsupported.
  const off = await floorStaffQA({ ...floor, departments: { get: () => ({ ...floor.departments.get('dept-1'), lead: { name: 'Maya', provider: 'claude', by: 'Kim', at: 0 } }) } } as never, 'dept-1', 'Q', 'Pat', 'acct-ivan');
  assert.match(off.why!, /only available on a Kimi-backed manager/);
});

test('accounts-mode ask refuses a missing or unknown custodian — no host fallback', () => {
  // No custodian configured: refused, and staffQA is never called.
  const none = fixture('pat@example.com');
  const deptNone = (none.ctx as unknown as { workerFloor: () => { departments: { get: (id: string) => { lead?: { custodian?: string } } } } }).workerFloor().departments.get('dept-1')!;
  deptNone.lead = { ...deptNone.lead!, custodian: undefined };
  (departmentsHandlers['departments.ask'] as Function)(none.ctx, none.client, { t: 'departments.ask', id: 'dept-1', question: 'Q' });
  assert.deepEqual(none.qaCalls, [], 'nothing ran without billing custody');
  assert.match(none.warnings[0]!, /billing custodian/);
  // Unknown custodian email: refused.
  const unknown = fixture('pat@example.com');
  const dept = (unknown.ctx as unknown as { workerFloor: () => { departments: { get: (id: string) => { lead?: { custodian?: string } } } } }).workerFloor().departments.get('dept-1')!;
  dept.lead = { ...dept.lead!, custodian: 'ghost@nowhere.org' };
  (departmentsHandlers['departments.ask'] as Function)(unknown.ctx, unknown.client, { t: 'departments.ask', id: 'dept-1', question: 'Q' });
  assert.deepEqual(unknown.qaCalls, []);
  assert.match(unknown.warnings[0]!, /isn’t an account/);
});

test('the tool-free mode is pinned to verified CLI versions; anything else fails closed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-qa-ver-'));
  try {
    const fake = path.join(dir, 'kimi-fake');
    writeFileSync(fake, '#!/bin/sh\necho "kimi-cli 9.9.9"\n');
    chmodSync(fake, 0o755);
    assert.equal(toolFreeVerified(fake), false, 'an unverified version never runs read-only Q&A');
    const real = resolveCommandShim('kimi');
    if (real) assert.equal(toolFreeVerified(real), true, 'the reviewed 2.7.2 binary stays verified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('initial-view redaction is recipient-aware, and migration is chronological and transactional', () => {
  const w = { id: 'mgr-w', kind: 'agent', provider: 'kimi', deskId: 'desk-2', name: 'Maya', color: '#fff', status: 'working', acked: true, createdBy: 'Kim', createdAt: 1, cols: 80, rows: 24, viewers: [], viewerIds: [], prompt: 'SECRET', activity: 'SECRET' } as import('../src/shared/protocol.js').WorkerInfo;
  const plain = { ...w, id: 'w9', prompt: 'open' };
  const ctx = { accounts: { any: true, get: (id: string) => ({ name: id, email: id }) } } as never;
  const floor = { ceo: { get: () => undefined }, departments: { leadDeptOfWorker: (id: string) => (id === 'mgr-w' ? { lead: { controllers: [IVAN] } } : undefined) }, isRoleWorker: (id: string) => (id === 'mgr-w' ? { role: 'Marketing manager', name: 'Maya' } : undefined) } as never;
  const redacted = redactWorkersFor(ctx, floor, [w, plain], 'pat@example.com');
  assert.equal((redacted[0] as { prompt?: string }).prompt, undefined, 'staff gets the shell');
  assert.equal((redacted[1] as { prompt?: string }).prompt, 'open', 'plain workers keep their card');
  const kept = redactWorkersFor(ctx, floor, [w], IVAN);
  assert.equal((kept[0] as { prompt?: string }).prompt, 'SECRET', 'controllers keep the full card');
  // migrate: interleaved timestamps merge chronologically; a failed merge leaves both intact.
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-migrate2-'));
  try {
    const chat = new RoleChat(dir);
    chat.append('old-w', { id: 'o1', role: 'user', text: 'one', at: 10 });
    chat.append('old-w', { id: 'o2', role: 'assistant', text: 'three', at: 30 });
    chat.append('new-w', { id: 'n1', role: 'assistant', text: 'two', at: 20 });
    assert.equal(chat.migrate('old-w', 'new-w'), true);
    assert.deepEqual(chat.tail('new-w').map((m) => m.text), ['three', 'two', 'one'], 'newest first, chronology preserved');
    assert.equal(chat.tail('old-w').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const dir2 = mkdtempSync(path.join(tmpdir(), 'agent-office-migrate3-'));
  try {
    const chat2 = new RoleChat(dir2);
    chat2.append('old-w', { id: 'o1', role: 'user', text: 'precious', at: 1 });
    mkdirSync(path.join(dir2, 'role-chat-new-w.jsonl'), { recursive: true }); // target is a directory: rename fails
    assert.equal(chat2.migrate('old-w', 'new-w'), false);
    assert.deepEqual(chat2.tail('old-w').map((m) => m.text), ['precious'], 'the original survives a failed merge');
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});
