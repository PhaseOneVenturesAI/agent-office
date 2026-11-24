import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffHandlers } from '../src/server/ws/handlers/handoffs.js';

test('failed seat persistence retains swap; retry completes without redelivering handoff',()=>{
 let delivered=0,cleared=0,fail=true;const warnings:string[]=[];const toasts:string[]=[];const results:any[]=[];
 const handoff={id:'h',to:'new',toName:'Replacement',state:'pending'};
 const source={id:'old',name:'CEO',provider:'kimi',swap:{engine:'codex'},handoff};
 const target={id:'new',provider:'codex'};
 const floor={workers:{get:(id:string)=>id==='old'?source:target,ownerOf:()=> 'owner',handoffs:{acknowledge:()=>{delivered++;handoff.state='acknowledged';},clearSwap:()=>{cleared++;}}},relinkEverywhere:()=>fail?'History unavailable':undefined};
 const ctx={sendTo:(_c:unknown,m:any)=>results.push(m),workerFloor:()=>floor,floorOf:()=>floor,signins:{officeRevoked:()=>false},warn:(_c:unknown,e:string)=>{if(e)warnings.push(e);},toastFloor:(_f:unknown,s:string)=>toasts.push(s)} as never;
 const client={accountId:'owner',peer:{name:'Owner'}} as never;
 const msg={t:'handoff.ack' as const,workerId:'old',handoffId:'h'};
 handoffHandlers['handoff.ack'](ctx,client,msg);
 assert.equal(delivered,1);assert.equal(cleared,0);assert.equal(toasts.length,0);assert.match(results[0].error,/History/);assert.equal(results[0].ok,false);assert.equal(results[0].handoff.state,'acknowledged');
 fail=false;handoffHandlers['handoff.ack'](ctx,client,msg);
 assert.equal(delivered,1);assert.equal(cleared,1);assert.equal(toasts.length,1);assert.equal(results[1].ok,true);assert.equal(results[1].handoffId,'h');
});
