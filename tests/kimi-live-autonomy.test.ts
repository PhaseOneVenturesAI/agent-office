import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { KimiSession } from '../src/server/kimi.js';
import { KimiAutonomy } from '../src/server/kimi-autonomy.js';

for (const scenario of ['ack', 'reject', 'unadvertised', 'unverified', 'conflict'] as const) {
  test(`live Kimi ${scenario}: preserves active work and its existing approval`, async t => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kimi-live-mode-')), script = path.join(dir, 'fake.mjs'), log = path.join(dir, 'calls');
    writeFileSync(log, '');
    writeFileSync(script, `import readline from 'node:readline';import {appendFileSync} from 'node:fs';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');const result=r=>send({jsonrpc:'2.0',id:m.id,result:r});
if(m.method==='initialize')result({protocolVersion:1,agentInfo:{name:'Kimi',version:${JSON.stringify(scenario === 'unverified' ? '2.7.3' : '2.7.2')}}});
if(m.method==='session/new')result({sessionId:'own',modes:{currentModeId:'default',availableModes:[{id:'default'},${scenario === 'unadvertised' ? '' : "{id:'auto'},"}{id:'yolo'}]}});
if(m.method==='session/prompt')send({jsonrpc:'2.0',id:'permission',method:'session/request_permission',params:{sessionId:'own',toolCall:{title:'Dummy tool',kind:'execute'},options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'always',name:'Allow always',kind:'allow_always'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});
if(m.method==='session/set_mode')setTimeout(()=>{${scenario === 'reject' ? "send({jsonrpc:'2.0',id:m.id,error:{code:-1,message:'No'}});" : `${scenario === 'conflict' ? "send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'own',update:{sessionUpdate:'current_mode_update',currentModeId:'default'}}});" : ''}result({});`} },60);
if(m.method==='session/close')process.exit(0);
});`);
    const observed: { mode: string | undefined; source?: string }[] = []; let ended = false;
    const session = new KimiSession({ file: process.execPath, args: [script], cwd: dir, env: process.env, firstPrompt: 'Keep working.' }, {
      output() {}, status() {}, action() {}, usage() {}, session() {}, prompted() {}, autonomy(mode, source) { observed.push({ mode, source }); }, exit() { ended = true; },
    });
    t.after(async () => { await session.close(); rmSync(dir, { recursive: true, force: true }); });
    session.start(); const deadline = Date.now() + 3000;
    while (!session.approvals().queued && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
    assert.equal(session.approvals().queued, 1); const approvalId = session.approvals().request?.id;
    const changing = session.setAutonomy('autonomous');
    assert.ok(!observed.some(x => x.mode === 'autonomous' && x.source === 'ack'));
    const result = await changing;
    assert.equal(result.applied, scenario === 'ack'); assert.equal(ended, false); assert.equal(session.running, true);
    assert.equal(session.approvals().queued, 1); assert.equal(session.approvals().request?.id, approvalId);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!calls.some(x => x.id === 'permission' || x.method === 'session/cancel' || x.method === 'session/close'));
    assert.ok(!calls.some(x => x.params?.modeId === 'yolo'));
    assert.equal(observed.some(x => x.mode === 'autonomous' && x.source === 'ack'), scenario === 'ack');
    if (scenario === 'unadvertised' || scenario === 'unverified') assert.ok(!calls.some(x => x.method === 'session/set_mode'));
  });
}

test('ACP current-mode reports supersede old acknowledgments and serialized errors never invent an ACK', async () => {
  const seen: unknown[] = []; const modes = new KimiAutonomy((mode, source) => seen.push([mode, source]));
  modes.adopt({ modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'auto' }, { id: 'yolo' }] } });
  assert.equal((await modes.set('autonomous', async () => undefined, () => true)).applied, false);
  assert.equal((await modes.set('autonomous', async () => { throw new Error('timeout'); }, () => true)).applied, false);
  assert.equal(seen.length, 1);
  const calls: string[] = [];
  const first = modes.set('autonomous', async id => { calls.push(id); await new Promise(r => setTimeout(r, 20)); return {}; }, () => true);
  const second = modes.set('supervised', async id => { calls.push(id); return {}; }, () => true);
  assert.deepEqual(await Promise.all([first, second]), [{ applied: true }, { applied: true }]); assert.deepEqual(calls, ['auto', 'default']);
  modes.update({ sessionUpdate: 'current_mode_update', currentModeId: 'auto' }); assert.deepEqual(seen.at(-1), ['autonomous', 'observed']);
  modes.update({ sessionUpdate: 'current_mode_update', currentModeId: 'default' }); assert.deepEqual(seen.at(-1), ['supervised', 'observed']);
  modes.update({ sessionUpdate: 'current_mode_update', currentModeId: 'yolo' }); assert.deepEqual(seen.at(-1), [undefined, 'observed']);
});
