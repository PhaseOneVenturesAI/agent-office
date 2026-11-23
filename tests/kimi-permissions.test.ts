import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KimiSession } from '../src/server/kimi.js';
import type { WorkerStatus } from '../src/shared/protocol.js';

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= end) throw new Error('Fake ACP condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(t: test.TestContext, mode = 'normal') {
  const home = mkdtempSync(path.join(tmpdir(), 'office-kimi-permissions-'));
  const script = path.join(home, 'agent.mjs');
  const responses = path.join(home, 'responses.jsonl');
  writeFileSync(responses, '');
  writeFileSync(script, `import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
let promptId, answered = 0;
readline.createInterface({input:process.stdin}).on('line', line => {
 const m = JSON.parse(line);
 const result = value => send({jsonrpc:'2.0',id:m.id,result:value});
 if (m.method==='initialize') result({protocolVersion:1});
 if (m.method==='session/new') result({sessionId:'session'});
 if (m.method==='session/prompt') {
  promptId=m.id;
  for (const id of ['first','second']) send({jsonrpc:'2.0',id,method:'session/request_permission',params:{sessionId:'session',toolCall:{toolCallId:id,title:id+' command'},options:[{optionId:id+'-allow',kind:'allow_once',name:'Allow once'},...(${JSON.stringify(mode)}==='no-reject'?[]:[{optionId:id+'-reject',kind:'reject_once',name:'Reject'}])]}});
  if (${JSON.stringify(mode)}==='early-end') result({stopReason:'cancelled'});
 }
 if (m.result?.outcome) {
  appendFileSync(${JSON.stringify(responses)},JSON.stringify(m)+'\\n');
  if (++answered===2 && ${JSON.stringify(mode)}!=='early-end') send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}});
 }
 if (m.method==='session/close') process.exit(0);
});`);
  const statuses: WorkerStatus[] = [];
  let output = '';
  const session = new KimiSession({file:process.execPath,args:[script],cwd:home,env:process.env,firstPrompt:'work'}, {
    output: (text) => { output += text; }, status: (s) => statuses.push(s), action() {}, usage() {}, session() {}, prompted() {}, exit() {},
  });
  t.after(async () => { await session.close(); rmSync(home, {recursive:true,force:true}); });
  session.start();
  await until(() => statuses.includes('needs_input'));
  // Wait for the fake agent's two frames to be received before answering either.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return {session, statuses, output: () => output, answers: () => readFileSync(responses,'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))};
}

test('Kimi queues overlapping approval requests and remains needs_input until each is answered', async (t) => {
  const f = await fixture(t);
  assert.match(f.output(), /first command/);
  assert.doesNotMatch(f.output(), /second command/);
  assert.deepEqual(f.answers(), []);
  f.session.writeInput('\r');
  await until(() => f.answers().length === 1);
  assert.equal(f.answers()[0].id, 'first');
  assert.equal(f.answers()[0].result.outcome.optionId, 'first-allow');
  assert.equal(f.statuses.at(-1), 'needs_input');
  assert.match(f.output(), /second command/);
  f.session.writeInput('1'); // A partially typed approval must not survive rejection.
  f.session.writeInput('\x1b');
  await until(() => f.statuses.at(-1) === 'done');
  assert.deepEqual(f.answers().map((a) => [a.id,a.result.outcome.optionId]), [['first','first-allow'],['second','second-reject']]);
});

test('closing Kimi cancels every queued approval without approving any', async (t) => {
  const f = await fixture(t);
  await f.session.close();
  assert.deepEqual(f.answers().map((a) => [a.id,a.result.outcome.outcome]), [['first','cancelled'],['second','cancelled']]);
  f.session.writeInput('\r');
  assert.equal(f.answers().length, 2);
});

test('a cancelled Kimi turn clears outstanding requests instead of leaving stale approvals', async (t) => {
  const f = await fixture(t, 'early-end');
  await until(() => f.statuses.at(-1) === 'done' && f.answers().length === 2);
  assert.ok(f.answers().every((a) => a.result.outcome.outcome === 'cancelled'));
  f.session.writeInput('\r');
  assert.equal(f.answers().length, 2);
});

test('Esc with no reject option cancels all pending approvals before cancelling the turn', async (t) => {
  const f = await fixture(t, 'no-reject');
  f.session.writeInput('\x1b');
  await until(() => f.answers().length === 2);
  assert.ok(f.answers().every((a) => a.result.outcome.outcome === 'cancelled'));
  assert.doesNotMatch(f.output(), /second command/);
});
