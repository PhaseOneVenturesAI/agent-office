import { WorkerTasks } from '../src/server/workers/tasks.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';
import { queueHandlers } from '../src/server/ws/handlers/queue.js';
import { reviewsHandlers } from '../src/server/ws/handlers/reviews.js';
import { meetingHandlers } from '../src/server/ws/handlers/meetings.js';
import { officeWorkers } from '../src/server/hooks/office-workers.js';
import { SignIns } from '../src/server/signins.js';
import { officeCredentialGrant } from '../src/server/office-credential-grants.js';
import { canUseWorker, personalProviderError, publicWorker } from '../src/server/worker-ownership.js';
import { WorkerManager } from '../src/server/workers.js';
import { messaging } from '../src/server/office/messaging.js';
import { screensOf } from '../src/server/office/views.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import type { WorkerInfo, WorkerClientMsg, QueueClientMsg } from '../src/shared/protocol.js';

function fixture(actor: string | undefined = 'bob', owner: string | undefined = 'alice') {
  const calls: string[] = [];
  const warnings: string[] = [];
  const info = {id:'worker',provider:'kimi',kind:'agent',name:'Pixel',owner,deskId:'desk-1',createdAt:0,status:'idle',viewers:[]} as WorkerInfo;
  const workers = {
    get: (id: string) => id === info.id ? info : undefined,
    ownerOf: () => owner,
    list: () => [info],
    defaultProvider:'kimi', officeDefault:{provider:'kimi'},
    authenticate: () => ({...info,id:'caller',name:'Caller',owner:actor}),
    resume: () => {calls.push('resume');},
    prompt: () => {calls.push('prompt');},
    write: () => {calls.push('write');},
    attach: () => {calls.push('attach'); return {data:'private chat',cols:80,rows:24};},
    resize: () => {calls.push('resize');},
    fullScreens: () => [{workerId:'worker',frame:{cols:80,rows:24,lines:{},cursor:[0,0]}}],
  };
  const task = {id:'task',owner,provider:'kimi'};
  const floor = {id:'floor',workers,queue:{state:()=>({tasks:[task]}),retry:()=>calls.push('retry'),remove:()=>calls.push('remove'),move:()=>calls.push('move'),clear:()=>calls.push('clear')},github:{pulls:{items:[]}},meetings:{state:()=>({current:{owner,provider:'kimi'}}),stop:()=>calls.push('stop'),clear:()=>calls.push('meeting.clear')}};
  const ctx = {
    workerFloor: () => floor, floorOf: () => floor,
    signins:{officeAllowed:()=>false,officeRevoked:()=>false}, meOf:()=>({admin:true}),
    accounts:{get:(id:string)=>({name:id==='alice'?'Alice':'Bob'})},
    warn: (_c:unknown, error:unknown) => {if(error) warnings.push(String(error));},
    sendTo:()=>calls.push('send'),toastAll() {},toastFloor() {},
    reviews:{resolve:()=>({item:{workerId:'worker',title:'Review',status:'rejected'},prompt:'Fix it'})},
    floors:new Map([['floor',floor]]),
  } as unknown as Ctx;
  const client = {id:'browser',accountId:actor,peer:{name:'Bob',floor:'floor'},attached:new Set(['worker']),typingAt:new Map(),ws:{readyState:1,bufferedAmount:0,send:()=>calls.push('ws.send')}} as unknown as Client;
  return {ctx,client,calls,warnings,floor,info};
}

const controls: WorkerClientMsg[] = [
  {t:'worker.resume',workerId:'worker'}, {t:'worker.prompt',workerId:'worker',prompt:'Spend tokens'},
  {t:'worker.attach',workerId:'worker'}, {t:'term.input',workerId:'worker',data:'yes\r'},
  {t:'term.resize',workerId:'worker',cols:100,rows:30},
];
for (const msg of controls) test(`${msg.t} denies a different account, including admins, and allows the owner`, () => {
  const denied = fixture();
  (workerHandlers[msg.t as keyof typeof workerHandlers] as Function)(denied.ctx,denied.client,msg);
  assert.equal(denied.calls.length,0); assert.ok(denied.warnings.length);
  const own = fixture('alice');
  (workerHandlers[msg.t as keyof typeof workerHandlers] as Function)(own.ctx,own.client,msg);
  assert.ok(own.calls.length);
});

test('worker controls require current floor and shared-password workers still work', () => {
  const f = fixture('alice'); f.ctx.floorOf = () => ({id:'other'} as any);
  workerHandlers['worker.prompt'](f.ctx,f.client,{t:'worker.prompt',workerId:'worker',prompt:'no'});
  assert.deepEqual(f.calls,[]);
  const shared = fixture(); shared.client.accountId = undefined;
  shared.floor.workers.ownerOf = () => undefined;
  workerHandlers['worker.prompt'](shared.ctx,shared.client,{t:'worker.prompt',workerId:'worker',prompt:'yes'});
  assert.deepEqual(shared.calls,['prompt']);
});

for (const action of ['retry','remove','move'] as const) test(`queue.${action} cannot operate another account's task`, () => {
  const f = fixture(); const msg = {t:`queue.${action}`,taskId:'task',delta:1} as QueueClientMsg;
  (queueHandlers[msg.t] as Function)(f.ctx,f.client,msg);
  assert.deepEqual(f.calls,[]); assert.ok(f.warnings.length);
  f.client.accountId = 'alice';
  (queueHandlers[msg.t] as Function)(f.ctx,f.client,msg);
  assert.deepEqual(f.calls,[action]);
});

test('a review remains recorded but cannot prompt another account’s agent', () => {
  const f = fixture(); reviewsHandlers['reviews.resolve'](f.ctx,f.client,{t:'reviews.resolve',id:'review',ok:false,reason:'fix'});
  assert.deepEqual(f.calls,[]); assert.match(f.warnings[0],/Review saved/);
  f.client.accountId='alice'; reviewsHandlers['reviews.resolve'](f.ctx,f.client,{t:'reviews.resolve',id:'review',ok:false,reason:'fix'});
  assert.deepEqual(f.calls,['prompt']);
});

test('meeting controls cannot stop another account’s agents', () => {
  const f = fixture(); meetingHandlers['meeting.stop'](f.ctx,f.client,{t:'meeting.stop'});
  assert.deepEqual(f.calls,[]);
  f.client.accountId='alice'; meetingHandlers['meeting.stop'](f.ctx,f.client,{t:'meeting.stop'});
  assert.deepEqual(f.calls,['stop']);
});

test('an occupied board agent refuses another account without replacing its session', () => {
  const calls:string[]=[];
  const manager = {workers:new Map([['board',{owner:'alice',info:{id:'board',deskId:'station-issues',status:'idle'},pty:{}}]]),prompt:()=>calls.push('prompt'),resume:()=>calls.push('resume')};
  assert.match(WorkerManager.prototype.station.call(manager as any,'station-issues','Bob','New task','bob') as string,/another account/);
  assert.deepEqual(calls,[]);
});

test('MCP tell cannot spend another owner’s credentials but same-owner handoff works', async () => {
  for (const actor of ['bob','alice']) {
    const f = fixture(actor);
    f.floor.workers.ownerOf = (id?: string) => id === 'caller' ? actor : 'alice';
    const req=Readable.from([Buffer.from(JSON.stringify({worker:'worker',prompt:'Do work'}))]) as http.IncomingMessage;
    req.method='POST'; req.headers={authorization:'Bearer synthetic'};
    let status=0;
    const res={writeHead(code:number){status=code;return this;},end(){}} as unknown as http.ServerResponse;
    await officeWorkers(f.ctx,req,res,new URL('http://local/office/workers/tell?worker=caller'));
    assert.equal(status,actor==='alice'?200:403);
    assert.deepEqual(f.calls,actor==='alice'?['prompt']:[]);
  }
});

test('private terminal screens are filtered while public workers carry the account name', () => {
  const f = fixture();
  f.ctx.clients = new Map([[f.client.id,f.client]]);
  messaging(f.ctx).toFloor(f.floor as any,{t:'screen',workerId:'worker',cols:80,rows:24,lines:{},full:true,cursor:[0,0]});
  screensOf(f.ctx,f.client,f.floor as any);
  assert.deepEqual(f.calls,[]);
  assert.equal(publicWorker(f.ctx,f.info).ownerName,'Alice');
  f.client.accountId='alice'; screensOf(f.ctx,f.client,f.floor as any);
  assert.deepEqual(f.calls,['send']);
});

test('personal sign-ins replace host credentials; office grants are explicit, provider scoped and revocable', (t) => {
  const dir=mkdtempSync(path.join(tmpdir(),'office-ownership-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const grantFile=path.join(dir,'office-credential-grants.json');
  const host={ANTHROPIC_API_KEY:'synthetic-host-claude',KIMI_API_KEY:'synthetic-host-kimi',OPENAI_API_KEY:'synthetic-host-codex',GH_TOKEN:'synthetic-host-github'};
  const signins=new SignIns(dir,null,null,null,null,()=>({...host}),(id,which)=>officeCredentialGrant(dir,id,which),()=>{});
  for(const id of ['alice01','bob0001']) {
    const env=signins.apply(id,{...host});
    for(const key of Object.keys(host)) assert.equal(env[key],undefined);
    assert.ok(env.KIMI_CODE_HOME.endsWith(`${id}/kimi`));
    assert.match(signins.useOffice(id,'kimi')!,/host owner/);
  }
  writeFileSync(grantFile,JSON.stringify({alice01:['kimi']}));
  assert.equal(signins.useOffice('alice01','kimi'),undefined);
  assert.equal(signins.apply('alice01',{...host}).KIMI_API_KEY,'synthetic-host-kimi');
  assert.match(signins.useOffice('alice01','claude')!,/host owner/);
  writeFileSync(grantFile,'{}');
  assert.equal(signins.ready('alice01','kimi'),false);
  assert.equal(signins.apply('alice01',{...host}).KIMI_API_KEY,undefined);
  writeFileSync(grantFile,'broken'); assert.equal(officeCredentialGrant(dir,'alice01','kimi'),false);
});

test('unsupported providers never silently use the host account; shared-password mode is unchanged', () => {
  for(const provider of ['cursor','grok','muse','opencode','dsh','pi','custom'] as const) {
    assert.match(personalProviderError('alice','agent',provider)!,/personal sign-in/);
    assert.equal(personalProviderError(undefined,'agent',provider),undefined);
  }
  for(const provider of ['claude','kimi','codex'] as const) assert.equal(personalProviderError('alice','agent',provider),undefined);
  const f=fixture(); assert.equal(canUseWorker(f.ctx,'bob',undefined,'kimi'),false);
});


test('revoking an inherited office GitHub credential blocks later prompts even when the agent uses personal Kimi', () => {
  const f=fixture('alice'); f.ctx.signins.officeRevoked = (_id, which) => which === 'github';
  workerHandlers['worker.prompt'](f.ctx,f.client,{t:'worker.prompt',workerId:'worker',prompt:'Continue'});
  assert.deepEqual(f.calls,[]); assert.ok(f.warnings.length);
});


test('account-owned task labels never send prompts or tool snippets to the host Claude namer', () => {
  const worker:any={owner:'alice',info:{id:'worker',provider:'claude',kind:'agent'},prompts:[],tools:[],toolsSinceNamed:0,namedAt:0,taskEpoch:0};
  const ctx:any={workers:new Map([['worker',worker]]),emit(){},persist(){}};
  const tasks=new WorkerTasks(ctx,null,{});
  let requests=0; (tasks as any).namer.request=()=>{requests++;};
  tasks.notePrompt(worker,'Implement account-specific permissions');
  assert.equal(worker.info.task.name,'Implement account-specific permissions');
  for(let i=0;i<10;i++) tasks.noteTool(worker,'Private tool output');
  tasks.notePrompt(worker,'Continue with the user settings page');
  assert.equal(requests,0); assert.deepEqual(worker.tools,[]);
  assert.match(worker.info.task.summary,/user settings/);
  worker.owner=undefined; tasks.notePrompt(worker,'New shared office task with existing behavior');
  assert.equal(requests,1);
});
