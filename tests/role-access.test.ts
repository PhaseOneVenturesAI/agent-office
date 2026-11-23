// Role access and the staff-Q&A boundary (see src/server/role-access.ts and staff-qa.ts), tested
// at the handler level like PR37's ownership tests: the CEO is private to its owner — an unrelated
// OFFICE ADMIN cannot seize ownership, edit the CEO, or chat with it. Staff questions never enter
// the manager's provider session: the manager's conversation refuses them, and the read-only Ask
// runs on a separate no-tools ACP session that auto-rejects every tool request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ceoHandlers } from '../src/server/ws/handlers/ceo.js';
import { departmentsHandlers } from '../src/server/ws/handlers/departments.js';
import { conversationHandlers } from '../src/server/ws/handlers/conversations.js';
import { staffQaAsk } from '../src/server/staff-qa.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

const OWNER = 'info@jdiaz.com';
const IVAN = 'ivanv@phaseoneventures.com';

/** An accounts office with a CEO (owned by info@jdiaz.com) and a marketing manager (Ivan controls). */
function fixture(actor: string | undefined, admin = false) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const sent: unknown[] = [];
  const ceo = { name: 'Avery', owner: OWNER, workerId: 'ceo-w', by: 'root', at: 0 };
  const lead = { name: 'Maya', workerId: 'mgr-w', controllers: [IVAN], audience: [], by: 'root', at: 0 };
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
      byEmail: (email: string) => ({ id: email, name: email.split('@')[0], email }),
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
  const outcome = await staffQaAsk({ file: process.execPath, args: [FAKE_QA], cwd: path.dirname(FAKE_QA), prompt: 'What is the brand color?', timeoutMs: 15000 });
  assert.deepEqual(outcome, { ok: true, answer: 'Short answer from the desk.' });
});
