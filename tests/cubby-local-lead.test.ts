import { owner } from './support/cubby-keys.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeLead, CODEX_BLOCKER, sessionBusy, APPROVAL_NOTICE } from '../src/server/cubbies/local/lead.js';
import { persistSelection, type LocalConfig } from '../src/server/cubbies/local/config.js';

const session = '12345678-1234-1234-1234-123456789abc';
function fixture(t: any, body?: string, fresh = false) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cubby-lead-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, 'repo'), state = path.join(home, 'state'), claudeHome = path.join(home, 'claude');
  mkdirSync(project); mkdirSync(state);
  const native = path.join(claudeHome, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'), session + '.jsonl');
  mkdirSync(path.dirname(native), { recursive: true }); if (!fresh) writeFileSync(native, 'NOT READ: private transcript');
  const capture = path.join(home, 'argv.json'), executable = path.join(home, 'fake-claude');
  const code = body ?? `
process.stdout.write(JSON.stringify({type:'system', secret:'SECRET'})+'\\n');
process.stdout.write(JSON.stringify({type:'assistant', session_id:session, parent_tool_use_id:null, message:{content:[{type:'tool_use',input:'SECRET'}, {type:'text',text:'Safe assistant response'}]}})+'\\n');
process.stdout.write(JSON.stringify({type:'user', session_id:session, message:{content:'PRIVATE TOOL RESULT'}})+'\\n');
process.stderr.write('PRIVATE CREDENTIAL');
process.stdout.write(JSON.stringify({type:'result',session_id:session,subtype:'success',is_error:false,result:'DO NOT FORWARD RESULT',permission_denials:[]})+'\\n');`;
  writeFileSync(executable, `#!${process.execPath}
if(process.argv[2]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));process.exit(0);}
const fs=require('node:fs'); const session=${JSON.stringify(session)};
fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.argv.slice(2)));
let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{
const frame=JSON.parse(input); if(frame.type!=='user'||frame.message.content!=='owner message')process.exit(2);
fs.writeFileSync(${JSON.stringify(native)},'native session exists');
${code}
});`, { mode: 0o700 });
  const config: LocalConfig = { ownerKey: owner.ownerKey, floor: 'f', project, roots: [project], branches: new Map([[project, 'main']]), state,
    computerId: session, provider: 'claude', session, executable, claudeHome, fresh };
  persistSelection(config);
  const lead = new NativeLead(config, async () => ({ complete: true, processes: [] }));
  t.after(() => lead.stop());
  return { home, config, lead, capture, native };
}

test('native CLI resumes exact conversation, sends text on stdin, and forwards only assistant text', async (t) => {
  const f = fixture(t);
  const answer = await f.lead.send('owner message', new AbortController().signal);
  assert.equal(answer, 'Safe assistant response');
  const args = JSON.parse(readFileSync(f.capture, 'utf8'));
  assert.deepEqual(args, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--resume', session]);
  assert.ok(!args.includes('owner message'));
  assert.equal(f.lead.busy, false);
});

test('locally authorized new lead gets one UUID then resumes it; deleting its native session cannot recreate it', async (t) => {
  const f = fixture(t, undefined, true);
  await f.lead.send('owner message', new AbortController().signal);
  assert.ok(JSON.parse(readFileSync(f.capture, 'utf8')).includes('--session-id'));
  await f.lead.send('owner message', new AbortController().signal);
  assert.ok(JSON.parse(readFileSync(f.capture, 'utf8')).includes('--resume'));
  assert.equal(JSON.parse(readFileSync(path.join(f.config.state, 'session.json'), 'utf8')).authorizedNew, false);
  rmSync(f.native);
  await assert.rejects(f.lead.send('owner message', new AbortController().signal), /missing or archived/);
});

test('Codex fails explicitly without spawning or faking desktop chat', async (t) => {
  const f = fixture(t); f.config.provider = 'codex';
  await assert.rejects(f.lead.send('owner message', new AbortController().signal), { message: CODEX_BLOCKER });
});

test('native approval refusals become a local-terminal notice, never new remote controls', async (t) => {
  const f = fixture(t, `process.stdout.write(JSON.stringify({type:'result',session_id:session,subtype:'success',permission_denials:[{tool_input:'SECRET'}]})+'\\n');`);
  await assert.rejects(f.lead.send('owner message', new AbortController().signal), { message: APPROVAL_NOTICE });
});

test('unknown process state, live project session, and same-session desktop in another cwd all fail busy', async (t) => {
  const f = fixture(t);
  const unknown = new NativeLead(f.config, async () => ({ complete: false, processes: [] }));
  await assert.rejects(unknown.send('owner message', new AbortController().signal), /Cannot verify/);
  const busy = new NativeLead(f.config, async () => ({ complete: true, processes: [{ pid: 9, ppid: 8, tool: 'claude', cwd: f.config.project }] }));
  await assert.rejects(busy.send('owner message', new AbortController().signal), /busy/);
  const dir = path.join(f.config.claudeHome, 'sessions'); mkdirSync(dir);
  writeFileSync(path.join(dir, process.pid + '.json'), JSON.stringify({ sessionId: session, pid: process.pid, cwd: '/other/scratch' }));
  assert.equal(sessionBusy(f.config), true);
  await assert.rejects(f.lead.send('owner message', new AbortController().signal), /another native terminal or desktop/);
});

test('disconnect kills only connector-owned process and stops output promptly; active turn cannot be entered twice', async (t) => {
  const f = fixture(t, `setInterval(()=>{},1000);`);
  const abort = new AbortController();
  const pending = f.lead.send('owner message', abort.signal);
  await assert.rejects(f.lead.send('owner message', abort.signal), /busy/);
  await new Promise((r) => setTimeout(r, 50));
  const before = Date.now(); abort.abort();
  await assert.rejects(pending, /cancelled/); await f.lead.stop();
  assert.ok(Date.now() - before < 1500); assert.equal(f.lead.busy, false);
});

test('wrong native session identity and unstructured output fail without disclosure', async (t) => {
  for (const body of [`process.stdout.write('SECRET invalid frame\\n');`,
    `process.stdout.write(JSON.stringify({type:'assistant',session_id:'other',message:{content:[{type:'text',text:'SECRET'}]}})+'\\n');`]) {
    const f = fixture(t, body);
    await assert.rejects(f.lead.send('owner message', new AbortController().signal), (e: Error) => !e.message.includes('SECRET'));
  }
});

test('API-key auth and unknown auth cannot launch a lead turn', async (t) => {
  const f = fixture(t);
  for (const auth of [{ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }, { loggedIn: false }]) {
    const lead = new NativeLead(f.config, async () => ({ complete: true, processes: [] }), async () => JSON.stringify(auth));
    await assert.rejects(lead.send('owner message', new AbortController().signal), /subscription sign-in/);
  }
});

test('oversized native output is terminated and never becomes telemetry', async (t) => {
  const f = fixture(t, `process.stdout.write('SECRET'.repeat(200000)); setInterval(()=>{},1000);`);
  await assert.rejects(f.lead.send('owner message', new AbortController().signal), /size limit/);
});
