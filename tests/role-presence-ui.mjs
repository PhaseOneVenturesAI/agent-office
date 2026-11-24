// Original Office geometry, real character/pointer/desk controllers; synthetic role/server data only.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.ROLE_PRESENCE_OUTPUT ?? '/tmp/agent-office-role-presence-ui'; mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5203, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.route('**/__role_presence.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}canvas{display:block}#hint{position:fixed;bottom:18px;left:18px;color:white;background:#263747;padding:12px;border-radius:10px}</style></head><body><div id="modal-root"></div><div id="toasts"></div><div id="hint">Walk up to a character · E / T to talk</div><script type="module">
import * as THREE from '/@fs/${process.cwd()}/node_modules/three/build/three.module.js';
import {buildOffice} from '/world/office/build.ts'; import {officeWorld} from '/world/world.ts';
import {store} from '/state/index.ts'; import {installDepartments} from '/features/departments/index.ts';
import {installWorkerActions} from '/features/workers/actions.ts'; import {installPointer} from '/input/pointer.ts';
import {Messages,Interactions,Ticks,Usables} from '/core/registry.ts'; import {Worker} from '/world/character/index.ts';
const scene=new THREE.Scene();scene.background=new THREE.Color('#cbdfe5');const office=buildOffice();scene.add(office.group);
const world=officeWorld(office,()=>false,()=>0);let currentWorld=world;
scene.add(new THREE.HemisphereLight('#fff8e8','#6c8595',2));const sun=new THREE.DirectionalLight('#fff3db',2);sun.position.set(-4,18,9);scene.add(sun);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.1,200);const resize=()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()};addEventListener('resize',resize);resize();
const player={pos:new THREE.Vector3(-11,0,-7),view:'third',locked:false};const listeners=new Set(),statuses=new Set();window.sent=[];window.genericActions=[];
const messages=new Messages(()=>{}), interactions=new Interactions(),ticks=new Ticks();
const receive=m=>{messages.dispatch(m);for(const f of [...listeners])f(m)};
window.roles=[{key:'ceo',name:'Avery',title:'CEO',deskId:'desk-1',talk:false,start:true,ask:false},{key:'manager:dev',department:'dev',name:'Maya',title:'Product manager',deskId:'desk-2',talk:false,start:false,ask:true},{key:'manager:review',department:'review',name:'Dev',title:'Review manager',deskId:'desk-3',talk:false,start:false,ask:true},{key:'manager:marketing',department:'marketing',name:'Priya',title:'Marketing manager',deskId:'desk-4',talk:false,start:false,ask:true}];
const net={up:true,send:m=>{window.sent.push(m);if(m.t==='role.presence.get')queueMicrotask(()=>receive({t:'role.presence',floor:store.floor,requestId:m.requestId,roles:window.roleError?[]:window.roles,...(window.roleError?{error:window.roleError}:{})}));if(m.t==='conversation.open')queueMicrotask(()=>receive({t:'conversation.state',workerId:m.workerId,supported:true,messages:[{id:'reply',role:'assistant',text:'Ready for your project objective.',at:1}]}));},onMessage:f=>{listeners.add(f);return()=>listeners.delete(f)},onStatus:f=>{statuses.add(f);return()=>statuses.delete(f)}};
store.floor='test-floor';store.ceo={ceo:{name:'Avery',provider:'kimi',model:'kimi-k2.5',owner:'owner@example.test',by:'Owner',at:1}};store.project={agentProviders:['kimi','claude','codex'],defaultProvider:'kimi'};
store.departments={departments:[{id:'dev',preset:'product',name:'Product',desks:['desk-2'],lead:{name:'Maya',provider:'kimi',by:'Owner',at:1}},{id:'review',preset:'review',name:'Review',desks:['desk-3'],lead:{name:'Dev',provider:'codex',by:'Owner',at:1}},{id:'marketing',preset:'marketing',name:'Marketing',desks:['desk-4'],lead:{name:'Priya',provider:'claude',by:'Owner',at:1}}],sources:[]};
const ctx={scene,camera,canvas:renderer.domElement,office,player,net,messages,interactions,ticks,usables:new Usables(),world:()=>currentWorld,plan:()=>currentWorld.plan,inOffice:()=>true,hint:{invalidate:()=>{}},activities:{busy:()=>false,any:()=>false},settings:{},me:{}};
const core={upTop:false,carrying:null};const worlds={plan:()=>world.plan,inOffice:()=>true,court:()=>undefined};
const presence=installDepartments(ctx);
installWorkerActions(ctx,core,{worlds,waiting:{openWorker:id=>window.genericActions.push(id),openWorkerTerminal:()=>{},openWorkerChanges:()=>{}},cards:{},meeting:{},seating:{},walking:{}});
const pointer=installPointer(ctx,core,{worlds,rooftop:{roof:()=>undefined},you:{reach:()=>{}},seating:{mySeat:()=>null},hoops:{ballAtFeet:()=>null,holding:()=>false},telescope:{active:false},boards:{issuesTex:{lift:()=>{}}},hintbar:{renderHint:()=>{},renderCrosshair:()=>{}},emotes:{emoteWheel:{isOpen:false}},hanging:{hanger:{active:false}},cards:{}});
renderer.domElement.addEventListener('click',e=>{const rect=renderer.domElement.getBoundingClientRect();player.onClick(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2))});
addEventListener('keydown',e=>{if(e.code==='KeyT'||e.code==='KeyE')pointer.use(pointer.target(),e.code.slice(3))});
const focus=key=>{const view=presence.avatars.get(key);const role=window.roles.find(r=>r.key===key);const desk=world.desks.get(role.deskId);const at=view?view.model.root.getWorldPosition(new THREE.Vector3()):desk.seatAnchor.getWorldPosition(new THREE.Vector3());player.pos.set(at.x,0,at.z);camera.position.set(at.x-1,at.y+3.2,at.z-4.7);camera.lookAt(at.x,at.y+.8,at.z);camera.updateMatrixWorld();return at};
window.focusRole=focus;window.presence=presence;window.store=store;window.receive=receive;window.world=world;window.ctx=ctx;
window.update=()=>{store.emit('ceo');store.emit('departments');store.emit('workers')};
window.makeActive=(key,provider='kimi')=>{const role=window.roles.find(r=>r.key===key);const id='active-'+key;const record={id,kind:'agent',provider,status:'idle',deskId:role.deskId,name:role.name,color:'#2b6f4e',viewers:[],viewerIds:[],acked:true,createdBy:'Owner',createdAt:1,cols:80,rows:24};store.workers.set(id,record);if(key==='ceo')store.ceo.ceo.workerId=id;else store.departments.departments.find(d=>d.id===role.department).lead.workerId=id;Object.assign(role,{workerId:id,talk:true,start:false});const model=new Worker(role.name,'#2b6f4e');model.setStatus('idle',false);world.desks.get(role.deskId).seatAnchor.add(model.root);window.update();return id};
window.connection=up=>{net.up=up;for(const f of statuses)f(up)};
window.changeFloor=()=>{store.floor='other-floor';window.roles=[];store.ceo={};store.departments={departments:[],sources:[]};store.workers.clear();store.emit('floor');window.update()};
window.switchWorld=()=>{currentWorld=currentWorld===world?{...world,desks:new Map(),interactables:[]}:world};
window.clickPoint=key=>{const v=presence.avatars.get(key);const at=v.badge.getWorldPosition(new THREE.Vector3());at.project(camera);return{x:(at.x+1)/2*innerWidth,y:(1-at.y)/2*innerHeight}};
window.update();let first=true;const frame=()=>{ticks.run({dt:1/60,t:performance.now()/1000,now:performance.now()});if(first&&presence.avatars.size){first=false;focus('ceo')}renderer.render(scene,camera);requestAnimationFrame(frame)};frame();window.ready=true;
</script></body></html>` }));
  await page.goto('http://127.0.0.1:5203/__role_presence.html');
  await page.waitForFunction(() => window.presence?.avatars.size === 4);
  assert.equal(await page.evaluate(() => window.store.workers.size), 0);
  await page.waitForTimeout(400);
  await page.screenshot({animations: 'disabled', path: out+'/office-off-shift-desktop.png' });
  // Real raycast click opens a character, never a hire or a provider call.
  const point = await page.evaluate(() => window.clickPoint('ceo'));
  await page.mouse.click(point.x, point.y);
  await page.getByRole('dialog', { name: 'Talk to Avery', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start shift', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.sent.filter(m => /launch|spawn|prompt/.test(m.t)).length), 0);
  await page.screenshot({animations: 'disabled', path: out+'/ceo-start-desktop.png' });
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  assert.equal(await page.evaluate(() => window.sent.filter(m => m.t==='ceo.launch').length), 1);
  assert.equal(await page.evaluate(() => window.sent.find(m => m.t==='ceo.launch').provider), 'kimi');
  await page.keyboard.press('Escape');
  // Occupied home stays visible beside the existing seat; no synthetic runtime appears.
  const before = await page.evaluate(() => window.presence.avatars.get('manager:dev').model.root.getWorldPosition(new (window.ctx.camera.position.constructor)()).toArray());
  await page.evaluate(() => {window.store.workers.set('ordinary',{id:'ordinary',deskId:'desk-2',kind:'shell'});window.update()});
  await page.waitForFunction(() => window.presence.avatars.size === 4);
  const after = await page.evaluate(() => window.presence.avatars.get('manager:dev').model.root.getWorldPosition(new (window.ctx.camera.position.constructor)()).toArray());
  assert.notDeepEqual(after,before); assert.equal(await page.evaluate(() => window.store.workers.size),1);
  // Native T/E reaches isolated Ask; the shared component sends only departments.ask.
  for (const key of ['t','e']) {
    await page.evaluate(() => window.focusRole('manager:dev')); await page.waitForTimeout(50); await page.keyboard.press(key);
    await page.getByRole('dialog',{name:'Talk to Maya',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Start shift',exact:true}).count(),0);
    await page.getByRole('textbox',{name:'Read-only question'}).fill('What is the current approved direction?');
    await page.getByRole('button',{name:'Ask (read-only)',exact:true}).click();
    await page.evaluate(()=>{const m=window.sent.at(-1);window.receive({t:'departments.qa',id:m.id,requestId:m.requestId,question:m.question,answer:'Keep the original office and its characters.',at:1})});
    await page.getByText('Keep the original office and its characters.',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.evaluate(()=>window.sent.filter(m=>m.t==='conversation.open').length),0);
  // Runtime replaces presence exactly once and desk E routes directly into existing Conversation.
  await page.evaluate(()=>window.makeActive('ceo','claude'));
  await page.waitForFunction(()=>window.presence.avatars.size===3);
  for(const provider of ['claude','codex','kimi']){
    await page.evaluate(provider=>{const id=window.roles[0].workerId;window.store.workers.get(id).provider=provider;window.ctx.interactions.use(window.world.interactables.find(it=>it.kind==='desk'&&it.deskId==='desk-1'),'E',null)},provider);
    await page.getByRole('dialog',{name:'Avery conversation',exact:true}).waitFor();
    await page.getByText('Ready for your project objective.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Terminal',exact:true}).count(),1);
    await page.getByRole('button',{name:'Terminal',exact:true}).click();
    await page.getByRole('dialog',{name:'Avery terminal',exact:true}).waitFor();
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.evaluate(()=>window.sent.filter(m=>m.t==='worker.resume'||m.t==='worker.spawn'||m.t==='worker.prompt').length),0);
  assert.equal(await page.evaluate(()=>window.genericActions.length),0);
  await page.evaluate(()=>{const w=window.store.workers.get(window.roles[0].workerId);w.lost={branch:'gone'};window.ctx.interactions.use(window.world.interactables.find(it=>it.kind==='desk'&&it.deskId==='desk-1'),'E',null);delete w.lost});
  assert.deepEqual(await page.evaluate(()=>window.genericActions),['active-ceo']);
  // Privacy-denied character has no Ask, start, transcript or terminal action.
  await page.evaluate(()=>{Object.assign(window.roles[0],{talk:false,start:false,ask:false,reason:'The CEO is private to its owner.'});window.ctx.interactions.use(window.world.interactables.find(it=>it.kind==='desk'&&it.deskId==='desk-1'),'T',null)});
  await page.getByText('The CEO is private to its owner.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Terminal',exact:true}).count(),0);
  await page.keyboard.press('Escape');
  // The same original scene and compact Ask fit a phone width.
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.focusRole('manager:dev'));await page.waitForTimeout(100);
  await page.screenshot({animations: 'disabled',path:out+'/office-off-shift-390.png'});await page.keyboard.press('t');
  await page.getByRole('dialog',{name:'Talk to Maya',exact:true}).waitFor();await page.screenshot({animations: 'disabled',path:out+'/manager-ask-390.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>window.connection(false));assert.equal(await page.getByRole('button',{name:'Ask (read-only)',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');await page.evaluate(()=>window.connection(true));
  // An unreadable persisted home is reported; retained file failure is never silently presented as success.
  await page.evaluate(()=>{window.roleError='Character homes could not be loaded. The original record is preserved.';window.update()});
  await page.getByText('Character homes could not be loaded. The original record is preserved.',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.presence.avatars.size===0);
  await page.evaluate(()=>{window.roleError=undefined;window.update()});await page.waitForFunction(()=>window.presence.avatars.size===3);
  // Even retained duplicate homes on a constrained floor get separate, deterministic positions.
  await page.evaluate(()=>{for(const role of window.roles)role.deskId='desk-1';window.update()});
  await page.waitForFunction(()=>new Set([...window.presence.avatars.values()].map(v=>v.model.root.position.toArray().join(','))).size===3);
  // Map and floor changes dispose old hit targets; returning to the map restores presence.
  await page.evaluate(()=>window.switchWorld());await page.waitForFunction(()=>window.presence.avatars.size===0);
  await page.evaluate(()=>window.switchWorld());await page.waitForFunction(()=>window.presence.avatars.size===3);
  await page.evaluate(()=>window.changeFloor());await page.waitForFunction(()=>window.presence.avatars.size===0);
  assert.equal(await page.evaluate(()=>window.world.interactables.filter(it=>it.kind==='role').length),0);
  assert.deepEqual(errors,[]);console.log('PASS original-map role presence, click/E/T, explicit launch, isolated Ask, all-provider Conversation, privacy, occupied homes, map/floor cleanup, desktop + 390px');
} finally {await browser.close();await server.close()}
