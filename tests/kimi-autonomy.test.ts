import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { KimiSession } from '../src/server/kimi.js';

for (const scenario of ['accepted', 'rejected', 'unadvertised', 'resume'] as const) {
  test(`Kimi autonomy ${scenario}: exact ACP mode acknowledged before any prompt`, async t => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kimi-autonomy-'));
    const script = path.join(dir, 'fake.mjs'), log = path.join(dir, 'calls');
    writeFileSync(log, '');
    writeFileSync(script, `import readline from 'node:readline';import {appendFileSync} from 'node:fs';
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
 const result=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:value})+'\\n');
 if(m.method==='initialize')result({protocolVersion:1});
 if(['session/new','session/resume'].includes(m.method))result({sessionId:'s',modes:{availableModes:${scenario === 'unadvertised' ? '[]' : '[{id:"auto"},{id:"default"},{id:"yolo"}]'}}});
 if(m.method==='session/set_mode') ${scenario === 'rejected' ? "process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-1,message:'Denied'}})+'\\n')" : 'result({})'};
 if(m.method==='session/prompt')result({stopReason:'end_turn'});
 if(m.method==='session/close')process.exit(0);
});`);
    let applied = false, done = false, error: string | undefined;
    const session = new KimiSession({ file: process.execPath, args: [script], cwd: dir, env: process.env, autonomy: 'autonomous', firstPrompt: 'hello', ...(scenario === 'resume' ? { resumeSessionId: 's' } : {}) }, {
      output() {}, status(s) { if(s === 'done') done = true; }, action() {}, usage() {}, session() {}, prompted() {}, autonomy() { applied = true; }, exit(_c, err) { error = err; done = true; },
    });
    t.after(async () => { await session.close(); rmSync(dir, { recursive: true, force: true }); });
    session.start();
    const deadline = Date.now() + 3000;
    while (!done && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.ok(done, 'session settles');
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s));
    if (scenario === 'accepted' || scenario === 'resume') {
      assert.equal(applied, true); assert.equal(error, undefined);
      const mode = calls.findIndex(c => c.method === 'session/set_mode');
      assert.equal(calls[mode].params.modeId, 'auto');
      assert.ok(calls.findIndex(c => c.method === 'session/prompt') > mode);
    } else {
      assert.equal(applied, false); assert.ok(error);
      assert.ok(!calls.some(c => c.method === 'session/prompt'));
    }
  });
}
