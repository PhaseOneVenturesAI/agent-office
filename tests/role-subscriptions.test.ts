import { startManager, assignObjective } from '../src/server/role-subscriptions/runtime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoleSubscriptions } from '../src/server/role-subscriptions/store.js';
import { subscriptionScope, managerExecution, canUseRoleWorker, roleDispatchError, staffQaExecution, departmentWorkerError, queuedDepartmentError } from '../src/server/role-subscriptions/access.js';
import { roleSubscriptionHandlers } from '../src/server/role-subscriptions/handlers.js';
import { departmentsHandlers } from '../src/server/ws/handlers/departments.js';
import { approvalAuthority } from '../src/server/ws/handlers/approvals.js';
import { conversationHandlers } from '../src/server/ws/handlers/conversations.js';
function setup(t: any) {
  const dir=mkdtempSync(path.join(tmpdir(),'role-consent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const accounts=['payer','ivan','eddie','ceo','outsider'].map(id=>({id,email:`${id}@example.test`,name:id}));
  const lead:any={name:'Development',provider:'kimi',custodian:'payer@example.test',controllers:['ivan@example.test','eddie@example.test'],workerId:'manager'};
  const dept:any={id:'dev',name:'Development',lead};let how='login',ready=true,owner='payer',sent=0;
  const workers:any={manager:{id:'manager',provider:'kimi'},personal:{id:'personal',provider:'kimi'},ceo:{id:'ceo',provider:'kimi'}};
  const floor:any={id:'project',def:{name:'Plimbo'},ceo:{get:()=>({workerId:'ceo',owner:'ceo@example.test'})},departments:{get:(id:string)=>id==='dev'?dept:undefined,leadDeptOfWorker:(id:string)=>id==='manager'?dept:undefined,setAccess:(_id:string,update:any)=>{Object.assign(lead,update)}},workers:{officeDefault:{provider:'kimi'},get:(id:string)=>workers[id],ownerOf:()=>owner,conversations:{send:()=>{sent++}}}};
  const messages:any[]=[],warnings:string[]=[];
  const ctx:any={accounts:{any:true,byEmail:(email:string)=>accounts.find(a=>a.email===email),get:(id:string)=>accounts.find(a=>a.id===id),state:()=>({accounts})},roleSubscriptions:new RoleSubscriptions(dir),signins:{ready:()=>ready,state:()=>({kimi:{how},claude:{how},codex:{how}}),officeRevoked:()=>false},floorOf:()=>floor,workerFloor:()=>floor,sendTo:(_c:any,m:any)=>messages.push(m),warn:(_c:any,e:string)=>{if(e)warnings.push(e)}};
  const client=(id:string)=>({accountId:id,peer:{name:id,floor:'project'}} as any);
  const grant=()=>{const scope=subscriptionScope(ctx,floor,'dev');roleSubscriptionHandlers['role.subscription.set'](ctx,client('payer'),{t:'role.subscription.set',department:'dev',allow:true,configuration:scope.configuration});};
  return {ctx,floor,lead,dir,messages,warnings,client,grant,setHow:(v:string)=>how=v,setReady:(v:boolean)=>ready=v,setOwner:(v:string)=>owner=v,turns:()=>sent};
}
test('only the named custodian consents; exact people/project/provider survive restart with no secrets',t=>{
 const f=setup(t),scope=subscriptionScope(f.ctx,f.floor,'dev');
 roleSubscriptionHandlers['role.subscription.set'](f.ctx,f.client('ivan'),{t:'role.subscription.set',department:'dev',allow:true,configuration:scope.configuration});
 assert.match(f.messages.at(-1).error,/Only the named/);assert.equal(f.ctx.roleSubscriptions.get('project','dev'),undefined);
 f.grant();assert.equal(f.messages.at(-1).state.active,true);
 assert.equal(managerExecution(f.ctx,f.floor,'dev','ivan').owner,'payer');assert.equal(managerExecution(f.ctx,f.floor,'dev','eddie').owner,'payer');
 assert.ok(managerExecution(f.ctx,f.floor,'dev','outsider').error);
 assert.equal(new RoleSubscriptions(f.dir).get('project','dev')?.custodian,'payer');
 assert.equal(subscriptionScope(f.ctx,{...f.floor,id:'other'},'dev').active,false);
 assert.equal(subscriptionScope(f.ctx,f.floor,'dev','codex').active,false);
});
test('stale consent, office credentials and missing personal signin are denied',t=>{
 const f=setup(t),old=subscriptionScope(f.ctx,f.floor,'dev').configuration;
 f.lead.controllers=['ivan@example.test'];
 roleSubscriptionHandlers['role.subscription.set'](f.ctx,f.client('payer'),{t:'role.subscription.set',department:'dev',allow:true,configuration:old});assert.match(f.messages.at(-1).error,/changed/);
 f.setHow('office');f.grant();assert.equal(f.messages.at(-1).state.active,false);
 f.setHow('login');f.setReady(false);f.grant();assert.equal(f.messages.at(-1).state.active,false);
});
test('real conversation and approvals require both current role authority and exact runtime custody',t=>{
 const f=setup(t);assert.equal(canUseRoleWorker(f.ctx,'ivan',f.floor,'manager'),false);
 f.grant();assert.equal(approvalAuthority(f.ctx,f.client('ivan'),'manager'),true);
 conversationHandlers['conversation.send'](f.ctx,f.client('ivan'),{t:'conversation.send',workerId:'manager',text:'Continue'});assert.equal(f.turns(),1);
 assert.equal(canUseRoleWorker(f.ctx,'ivan',f.floor,'personal'),false);assert.equal(canUseRoleWorker(f.ctx,'ivan',f.floor,'ceo'),false);
 f.setOwner('eddie');assert.equal(canUseRoleWorker(f.ctx,'ivan',f.floor,'manager'),false);f.setOwner('payer');
 f.lead.controllers=['eddie@example.test'];assert.equal(canUseRoleWorker(f.ctx,'ivan',f.floor,'manager'),false);
});
test('revocation blocks future shared turns, approvals and automatic notices; controller remove/readd cannot restore old consent',t=>{
 const f=setup(t);f.grant();
 f.ctx.roleSubscriptions.revoke('project','dev');
 conversationHandlers['conversation.send'](f.ctx,f.client('ivan'),{t:'conversation.send',workerId:'manager',text:'Continue'});assert.equal(f.turns(),0);
 assert.equal(approvalAuthority(f.ctx,f.client('ivan'),'manager'),false);assert.match(roleDispatchError(f.ctx,f.floor,'manager')!,/revoked/);
 f.grant();departmentsHandlers['departments.access'](f.ctx,f.client('ivan'),{t:'departments.access',id:'dev',controllers:['eddie@example.test']});
 f.lead.controllers=['ivan@example.test','eddie@example.test'];assert.equal(subscriptionScope(f.ctx,f.floor,'dev').active,false);
 assert.equal(canUseRoleWorker(f.ctx,'payer',f.floor,'personal'),true,'personal defaults untouched');
});

test('staff Q&A needs separate exact-audience consent, never inherited from controller permission',t=>{
 const f=setup(t);f.grant();assert.ok(staffQaExecution(f.ctx,f.floor,'dev','outsider').error);
 let configuration=subscriptionScope(f.ctx,f.floor,'dev').configuration;
 roleSubscriptionHandlers['role.subscription.set'](f.ctx,f.client('payer'),{t:'role.subscription.set',department:'dev',allow:true,configuration,allowStaffQA:true});
 assert.equal(staffQaExecution(f.ctx,f.floor,'dev','outsider').owner,'payer');
 f.lead.audience=['eddie@example.test'];assert.ok(staffQaExecution(f.ctx,f.floor,'dev','outsider').error);assert.ok(staffQaExecution(f.ctx,f.floor,'dev','eddie').error);
});

test('department child spend is exact-provider consent and queued starts recheck revocation',t=>{
 const f=setup(t);assert.ok(departmentWorkerError(f.ctx,f.floor,'manager','kimi'));f.grant();
 assert.equal(departmentWorkerError(f.ctx,f.floor,'manager','kimi'),undefined);
 assert.ok(departmentWorkerError(f.ctx,f.floor,'manager','codex'));
 const task:any={parentId:'manager',dept:'dev',owner:'payer',provider:'kimi'};
 assert.equal(queuedDepartmentError(f.ctx,f.floor,task),undefined);
 f.ctx.roleSubscriptions.revoke('project','dev');assert.ok(queuedDepartmentError(f.ctx,f.floor,task));
 assert.equal(queuedDepartmentError(f.ctx,f.floor,{...task,owner:'ivan'}),undefined,'human personal task stays personal');
});

test('launch resolves the confirmed custodian while live assignments never retarget another owner',t=>{
 const f=setup(t);let spawnedOwner:string|undefined;let objectives=0;
 Object.assign(f.floor.departments,{leadChoice:()=>({provider:'kimi'}),composeLeadLaunch:()=>({prompt:'Lead',lead:{name:'Dev'}}),recordLeadHire:()=>{},setObjective:()=>{objectives++}});
 f.floor.departments.get('dev').desks=['desk'];Object.assign(f.floor.workers,{list:()=>[],deskOccupied:()=>false,spawn:(...args:any[])=>{spawnedOwner=args[9];return {id:'new'}}});f.floor.project={};
 const authorize=(floor:any,department:string,actor:string|undefined,provider:any)=>managerExecution(f.ctx,floor,department,actor,provider);
 assert.match(startManager(f.floor,authorize,'dev','Ivan','ivan') as string,/consent/);assert.equal(spawnedOwner,undefined);
 f.grant();startManager(f.floor,authorize,'dev','Ivan','ivan');assert.equal(spawnedOwner,'payer');
 f.setOwner('old-payer');assert.match(assignObjective(f.floor,authorize,'dev','Build it','Ivan',{owner:'ivan'}) as string,/different subscription/);assert.equal(objectives,0);
});
