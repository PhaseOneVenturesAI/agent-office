import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canEditManager } from '../src/server/role-access.js';
import { RoleChat } from '../src/server/role-chat.js';
import { floorStaffQA } from '../src/server/dept-staff-qa.js';
import { relinkRoleSeat } from '../src/server/role-seats.js';

test('project owner can bootstrap a manager; an unrelated admin cannot', () => {
 const floor = {ceo:{get:()=>({owner:'owner@example.com'})}, departments:{get:()=>({id:'d'})}} as never;
 const ctx = {accounts:{any:true,get:(id:string)=>({email:id})},meOf:()=>({admin:true})} as never;
 assert.equal(canEditManager(ctx,floor,'d','owner@example.com').ok,true);
 assert.equal(canEditManager(ctx,floor,'d','admin@example.com').ok,false);
});

test('an empty role history does not prevent an engine swap', () => {
 const dir=mkdtempSync(path.join(tmpdir(),'office-role-empty-'));
 try {assert.equal(new RoleChat(dir).migrate('old','new'),true);} finally {rmSync(dir,{recursive:true,force:true});}
});

test('failed role history migration returns an actionable error without moving the role', () => {
 const moves:string[]=[];
 const floor={workers:{get:()=>({name:'CEO'})},roleChat:{migrate:()=>false},ceo:{get:()=>({workerId:'old'}),relinkWorker:()=>moves.push('ceo')},departments:{leadDeptOfWorker:()=>undefined,relinkWorker:()=>moves.push('dept')}} as never;
 const result=relinkRoleSeat({toast:()=>{}} as never,floor,'old','new');
 assert.equal(typeof result,'string');assert.deepEqual(moves,[]);
});

test('accounts-mode Q&A refuses missing custody before any CLI/environment access',async()=>{
 const floor={dir:'/unused',dataDir:'/unused',accountsEnabled:()=>true,departments:{get:()=>({name:'Marketing',lead:{provider:'kimi'}})},runAs:{ready:()=>{throw Error('must not inspect a missing account');}},roleChat:{append:()=>{}}} as never;
 const result=await floorStaffQA(floor,'d','What is the brand?','Staff',undefined,{file:'/definitely-absent-kimi',args:[]});
 assert.equal(result.ok,false);
 if(!result.ok) assert.match(result.why,/custodian/i);
});

test('role-save failure leaves source history intact and retry does not duplicate messages',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'office-role-save-'));const chat=new RoleChat(dir);chat.append('old',{id:'1',role:'user',text:'Original',at:1});
 let seat='old';let fail=true;
 const floor={workers:{get:()=>({name:'CEO'})},roleChat:chat,ceo:{get:()=>({workerId:seat}),relinkWorker:(_a:string,b:string)=>{if(fail)return 'disk full';seat=b;}},departments:{leadDeptOfWorker:()=>undefined}} as never;
 try{
 assert.match(relinkRoleSeat({} as never,floor,'old','new')!,/disk full/);assert.equal(seat,'old');assert.equal(chat.tail('old')[0].text,'Original');
 fail=false;assert.equal(relinkRoleSeat({} as never,floor,'old','new'),undefined);assert.equal(seat,'new');assert.equal(chat.tail('new').length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('configured project owner can bootstrap without an office-admin flag',()=>{
 const old=process.env.AGENT_OFFICE_CEO_OWNER;process.env.AGENT_OFFICE_CEO_OWNER='owner@example.com';
 try{
 const floor={ceo:{get:()=>undefined},departments:{get:()=>({id:'d'})}} as never;
 const ctx={accounts:{any:true,get:(id:string)=>({email:id})},meOf:()=>({admin:false})} as never;
 assert.equal(canEditManager(ctx,floor,'d','owner@example.com').ok,true);
 }finally{if(old===undefined)delete process.env.AGENT_OFFICE_CEO_OWNER;else process.env.AGENT_OFFICE_CEO_OWNER=old;}
});
