import {createServer} from 'vite';import {chromium} from 'playwright-core';import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:5200,strictPort:true}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('**/__routes.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><div id="modal-root"></div><div id="toasts"></div><div id="compass"></div><button id="waiting"></button><section id="workers-panel"></section><ul id="workers"></ul><span id="worker-count"></span><script type="module">
import {installWaiting} from '/features/waiting/index.ts';import {installWorkerActions} from '/features/workers/actions.ts';import {renderWorkers} from '/ui/workers-panel.ts';import {store} from '/state/index.ts';
const listeners=new Set(),statuses=new Set();window.sent=[];const net={up:true,send:m=>window.sent.push(m),onMessage:f=>{listeners.add(f);return()=>listeners.delete(f)},onStatus:f=>{statuses.add(f);return()=>statuses.delete(f)}};
store.floor='floor';store.me={admin:false,name:'Owner'};store.project={agentProviders:['claude','kimi','codex'],defaultProvider:'kimi'};store.workers.set('w',{id:'w',name:'Maya',kind:'agent',provider:'kimi',deskId:'desk',status:'needs_input',createdAt:Date.now(),color:'#f90',viewers:[],viewerIds:[]});
const desk={id:'desk',x:0,z:0,rotY:0,label:'Desk'};const plan=()=>({byId:new Map([['desk',desk]]),desks:[desk],overflow:[]});const routes={};const ctx={net,player:{pos:{x:0,y:0,z:0}},camera:{},settings:{},me:{},keys:{bind:()=>{}},ticks:{add:()=>{}},messages:{on:()=>{}},interactions:{define:(name,actions)=>routes[name]=actions}};
const worlds={plan,inOffice:()=>true};const waiting=installWaiting(ctx,{trip:false},{worlds,views:{workerViews:new Map()},actions:{standAt:()=>{},resumeWorker:()=>{},fixLostWorktree:()=>{}}});
installWorkerActions(ctx,{}, {worlds,waiting,seating:{},walking:{},meeting:{},cards:{}});renderWorkers(waiting.openWorker);
window.openDesk=()=>routes.desk.use({deskId:'desk'},'E');window.notify=()=>waiting.answerWorker('w');window.setProvider=p=>{store.workers.get('w').provider=p;renderWorkers(waiting.openWorker)};
window.addEventListener('keydown',e=>{if(e.key==='e')window.openDesk()});
</script>`}));
 await page.goto('http://127.0.0.1:5200/__routes.html');await page.locator('#workers li').waitFor({timeout:5000});
 for(const provider of ['kimi','claude','codex']){
  await page.evaluate(p=>window.setProvider(p),provider);
  await page.keyboard.press('e');await page.getByRole('dialog',{name:'Maya conversation'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Terminal',exact:true}).count(),1);await page.keyboard.press('Escape');
  await page.locator('#workers li').click();await page.getByRole('dialog',{name:'Maya conversation'}).waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>window.notify());await page.getByRole('dialog',{name:'Maya conversation'}).waitFor();await page.keyboard.press('Escape');
 }
 assert.equal((await page.evaluate(()=>window.sent)).filter(m=>m.t==='conversation.open').length,9);
 assert.deepEqual(errors,[]);console.log('Actual registered desk E, sidebar click and waiting notification routes open Conversation for Claude/Codex/Kimi.');
}catch(error){console.error(errors);throw error;}finally{await browser.close();await server.close()}
