import test from 'node:test';import assert from 'node:assert/strict';
import {departmentsHandlers} from '../src/server/ws/handlers/departments.js';
function fixture(){
 const messages:any[]=[],warnings:string[]=[];let persistence:string|undefined;
 const lead={controllers:['owner@example.test'],custodian:'owner@example.test'};
 const floor:any={id:'floor',ceo:{get:()=>({owner:'owner@example.test'})},departments:{get:()=>({id:'dev',lead}),setAccess:()=>persistence},staffQA:()=>Promise.resolve({ok:true,answer:'Answer'})};
 const ctx:any={accounts:{any:false},floorOf:()=>floor,stillIn:()=>true,warn:(_c:any,e:string)=>warnings.push(e),sendTo:(_c:any,m:any)=>messages.push(m)};
 return {ctx,floor,messages,warnings,client:{accountId:'owner',peer:{name:'Owner'}} as any,fail:(e:string)=>persistence=e};
}
test('role settings acknowledge exact request only after persistence and report failures',()=>{
 const f=fixture(),msg={t:'departments.access' as const,id:'dev',controllers:['owner@example.test'],requestId:'request'};
 departmentsHandlers['departments.access'](f.ctx,f.client,msg);assert.equal(f.messages[0].error,undefined);f.messages.length=0;
 f.fail('Disk save failed');departmentsHandlers['departments.access'](f.ctx,f.client,msg);assert.equal(f.messages[0].error,'Disk save failed');assert.equal(f.messages[0].requestId,'request');
});
test('unauthorized role settings reject through the same result instead of optimistic success',()=>{
 const f=fixture();f.ctx.accounts={any:true,get:()=>({email:'outsider@example.test'})};
 departmentsHandlers['departments.access'](f.ctx,f.client,{t:'departments.access',id:'dev',controllers:['outsider@example.test'],requestId:'denied'});
 assert.equal(f.messages[0].t,'role.settings.result');assert.match(f.messages[0].error,/Only/);
});
test('Ask immediate refusal and rejected provider promise return correlated inline failure',async()=>{
 const f=fixture(),msg={t:'departments.ask' as const,id:'dev',question:'Question',requestId:'ask'};
 f.floor.departments.get=()=>undefined;departmentsHandlers['departments.ask'](f.ctx,f.client,msg);assert.equal(f.messages[0].requestId,'ask');assert.match(f.messages[0].error,/Name/);
 f.floor.departments.get=()=>({lead:{}});f.floor.staffQA=()=>Promise.reject(new Error('provider failed'));
 departmentsHandlers['departments.ask'](f.ctx,f.client,msg);await new Promise(r=>setTimeout(r,0));assert.match(f.messages.at(-1).error,/failed/);
});
