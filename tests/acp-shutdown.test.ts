import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Real parent + ACP child. The child deliberately stays alive on pipe EOF, like a slow CLI. */
async function lifecycle(provider: 'kimi' | 'dsh', mode: 'term' | 'ignore-term' | 'close', signal: 'SIGTERM' | 'SIGINT' = 'SIGTERM') {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-acp-stop-'));
  const childFile = path.join(dir, 'agent.mjs'), parentFile = path.join(dir, 'parent.mjs'), log = path.join(dir, 'events.jsonl');
  writeFileSync(childFile, `import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
const log=${JSON.stringify(log)}, mode=${JSON.stringify(mode)};
const record=event=>appendFileSync(log,JSON.stringify({event,pid:process.pid,parent:process.ppid,at:Date.now()})+'\\n');
record('started');
setInterval(()=>{},1000);
process.on('SIGTERM',()=>{record('term');if(mode!=='ignore-term')process.exit(0)});
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);const result=value=>send({jsonrpc:'2.0',id:m.id,result:value});
 if(m.method==='initialize')result({protocolVersion:1});
 if(m.method==='session/new')result({sessionId:'shutdown-session'});
 if(m.method==='session/close'){record('close');if(mode==='close')process.exit(0);else result({});}
});`);
  const module = pathToFileURL(path.join(root, 'src/server', `${provider}.ts`)).href;
  writeFileSync(parentFile, `import {${provider === 'kimi' ? 'KimiSession' : 'DshSession'} as Session} from ${JSON.stringify(module)};
import {readFileSync,appendFileSync} from 'node:fs';
import {installShutdownSignals} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/server/shutdown-signals.ts')).href)};
const log=${JSON.stringify(log)};
const record=event=>appendFileSync(log,JSON.stringify({event,pid:process.pid,at:Date.now()})+'\\n');
const session=new Session({file:process.execPath,args:[${JSON.stringify(childFile)}],cwd:${JSON.stringify(dir)},env:{}},{
 output(){},status(s){if(s==='idle')process.send({ready:true,child:JSON.parse(readFileSync(log,'utf8').split('\\n')[0]).pid})},action(){},usage(){},session(){},prompted(){},exit(){record('child-exit-observed')}
});
process.on('exit',()=>record('parent-exiting'));
installShutdownSignals(async keep=>{record(keep?'parent-stopping-restart':'parent-stopping');await session.close();record('cleanup-returned')});
session.start();`);
  const parent = spawn(process.execPath, ['--import', 'tsx', parentFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let child = 0, stderr = '';
  parent.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ACP parent did not start: ${stderr}`)), 5000);
      parent.once('message', (message: any) => { child = message.child; clearTimeout(timer); resolve(); });
      parent.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ACP parent did not exit: ${stderr}`)), 6000);
      parent.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    parent.kill(signal);
    // A second service-manager signal must not force an early parent exit.
    const repeated = setTimeout(() => parent.kill(signal), 100);
    parent.once('exit', () => clearTimeout(repeated));
    assert.equal(await exited, 0, stderr);
    assert.equal(alive(child), false, `${provider} parent exited before its ACP child (${mode})`);
    const events = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const at = (event: string) => events.findIndex((entry) => entry.event === event);
    assert.ok(at('child-exit-observed') >= 0, 'must observe child exit, not just send a signal');
    assert.ok(at('child-exit-observed') < at('cleanup-returned'));
    assert.ok(at('cleanup-returned') < at('parent-exiting'));
    if (mode === 'close') assert.equal(at('term'), -1, 'a cooperatively closed child must not be signalled again');
    else assert.ok(at('term') >= 0, 'a slow ACP child receives its scoped termination signal');
  } finally {
    // Only this fixture's known processes; never a name match or a process-group kill.
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    if (child && alive(child)) process.kill(child, 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const provider of ['kimi', 'dsh'] as const) {
  test(`${provider} parent waits for a slow ACP child on SIGTERM`, () => lifecycle(provider, 'term'));
  test(`${provider} parent reaps an ACP child that ignores SIGTERM`, () => lifecycle(provider, 'ignore-term'));
  test(`${provider} parent observes cooperative ACP close on SIGINT`, () => lifecycle(provider, 'close', 'SIGINT'));
}
