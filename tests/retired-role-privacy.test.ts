import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoleChat } from '../src/server/role-chat.js';
import { roleAccess, redactWorkersFor } from '../src/server/role-access.js';
import { protectRoleHandoff, relinkRoleSeat } from '../src/server/role-seats.js';
import { canViewTerminal } from '../src/server/worker-ownership.js';
import { conversationHandlers } from '../src/server/ws/handlers/conversations.js';
import { messaging } from '../src/server/office/messaging.js';

function fixture(dir:string) {
 let seat='old';let fail=false;const sent:any[]=[];let calls=0;
 const worker=(id:string)=>({id,name:id,kind:'agent',provider:'kimi',owner:'alice',prompt:'PRIVATE',activity:'PRIVATE',viewers:[],viewerIds:[]});
 const floor:any={id:'f',roleChat:new RoleChat(dir),ceo:{get:()=>({workerId:seat,owner:'alice@example.com'}),relinkWorker:(_a:string,b:string)=>{if(fail)return 'disk full';seat=b;}},departments:{leadDeptOfWorker:()=>undefined,get:()=>undefined},workers:{get:worker,ownerOf:()=> 'alice',conversations:{send:()=>calls++,snapshot:()=>[{text:'PRIVATE'}],subscribe:()=>()=>{},page:()=>[]}}};
 floor.isRoleWorker=(id:string)=>id===seat?{role:'CEO',name:'CEO'}:undefined;
 const ctx:any={accounts:{any:true,get:(id:string)=>({email:`${id}@example.com`})},signins:{officeRevoked:()=>false,officeAllowed:()=>true},workerFloor:()=>floor,floorOf:()=>floor,stillIn:()=>true,warn:()=>{},sendTo:(_c:any,m:any)=>sent.push(m)};
 const client:any={id:'c',accountId:'bob',peer:{floor:'f',name:'Bob'},ws:{readyState:1,bufferedAmount:0,send:(s:string)=>sent.push(JSON.parse(s))}};ctx.clients=new Map([['c',client]]);
 return {floor,ctx,client,sent,worker,calls:()=>calls,fail:()=>{fail=true;}};
}

test('successful swap and restart retain source privacy on initial view, updates, terminal and chat',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'role-privacy-'));
 try{
 const f=fixture(dir);f.floor.roleChat.append('old',{id:'1',role:'user',text:'PRIVATE',at:1});
 assert.equal(protectRoleHandoff(f.floor,'old','new'),undefined);assert.equal(relinkRoleSeat({} as any,f.floor,'old','new'),undefined);
 f.floor.roleChat=new RoleChat(dir); // Reopen durable state, not an in-memory marker.
 assert.equal(f.floor.isRoleWorker('old'),undefined);
 assert.equal(roleAccess(f.ctx,f.floor,'old','bob').kind,'none');
 assert.equal(redactWorkersFor(f.ctx,f.floor,[f.worker('old')],'bob')[0].prompt,undefined);
 messaging(f.ctx).toFloor(f.floor,{t:'worker.update',worker:f.worker('old')} as any);
 assert.ok(!JSON.stringify(f.sent).includes('PRIVATE'));
 assert.equal(canViewTerminal(f.ctx,'bob','old'),false);assert.equal(canViewTerminal(f.ctx,'alice','old'),true);
 for(const t of ['conversation.open','conversation.send','conversation.page'] as const)(conversationHandlers[t] as Function)(f.ctx,f.client,{t,workerId:'old',text:'read'});
 assert.equal(f.calls(),0);assert.ok(!JSON.stringify(f.sent).includes('PRIVATE'));
 assert.equal(redactWorkersFor(f.ctx,f.floor,[f.worker('ordinary')],'bob')[0].prompt,'PRIVATE','ordinary workers retain existing public card behavior');
 assert.equal(f.floor.roleChat.tail('old')[0].text,'PRIVATE','source work/history retained');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('failed swap protects the recipient before delivery and retains source identity',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'role-privacy-fail-'));
 try{
 const f=fixture(dir);f.fail();assert.equal(protectRoleHandoff(f.floor,'old','new'),undefined);
 assert.match(relinkRoleSeat({} as any,f.floor,'old','new')!,/disk full/);
 f.floor.roleChat=new RoleChat(dir);
 assert.equal(f.floor.ceo.get().workerId,'old');assert.equal(roleAccess(f.ctx,f.floor,'new','bob').kind,'none');
 assert.equal(redactWorkersFor(f.ctx,f.floor,[f.worker('new')],'bob')[0].prompt,undefined);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('corrupt provenance stays private; revoked CEO owner cannot read old terminals or chat',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'role-privacy-corrupt-'));
 try{
 const f=fixture(dir);protectRoleHandoff(f.floor,'old','new');
 f.floor.ceo.get=()=>({workerId:'new',owner:'newowner@example.com'});
 assert.equal(canViewTerminal(f.ctx,'alice','old'),false);
 f.client.accountId='alice';(conversationHandlers['conversation.send'] as Function)(f.ctx,f.client,{workerId:'old',text:'run'});assert.equal(f.calls(),0);
 writeFileSync(path.join(dir,'role-origin-old.json'),'{broken');
 assert.equal(redactWorkersFor(f.ctx,f.floor,[f.worker('old')],'alice')[0].prompt,undefined);
 assert.equal(canViewTerminal(f.ctx,'alice','old'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('ordinary worker handoff neither gains role provenance nor changes role privacy',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'role-privacy-ordinary-'));
 try {const f=fixture(dir);assert.equal(protectRoleHandoff(f.floor,'ordinary','other'),undefined);assert.equal(f.floor.roleChat.privacy.get('ordinary'),undefined);assert.equal(f.floor.roleChat.privacy.get('other'),undefined);}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('a provenance write failure prevents handoff delivery',async()=>{
 const {handoffHandlers}=await import('../src/server/ws/handlers/handoffs.js');
 const dir=mkdtempSync(path.join(tmpdir(),'role-privacy-before-send-'));
 try{
 const f=fixture(dir);let delivered=0;f.client.accountId='alice';
 const old={...f.worker('old'),swap:{engine:'codex'},handoff:{id:'h',to:'new',state:'pending'}};
 f.floor.workers.get=(id:string)=>id==='old'?old:f.worker(id);
 f.floor.workers.handoffs={acknowledge:()=>delivered++};
 f.floor.roleChat.privacy.protect=()=> 'cannot persist provenance';
 handoffHandlers['handoff.ack'](f.ctx,f.client,{t:'handoff.ack',workerId:'old',handoffId:'h'});
 assert.equal(delivered,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
