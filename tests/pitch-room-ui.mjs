// Real UI + server handlers + admitted fake Mac link. No provider or external site calls (the live site is served by a local route).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
const { activityOffice } = await tsImport('./support/hq-activity.ts', import.meta.url);
const { pitchHandlers, pitchChanged, pitchView } = await tsImport('../src/server/ws/handlers/pitch.ts', import.meta.url);
const { hqView } = await tsImport('../src/server/hq/views.ts', import.meta.url);
const { talkView } = await tsImport('../src/server/hq/talk-views.ts', import.meta.url);
const { sendTalk } = await tsImport('../src/server/hq/talk-handlers.ts', import.meta.url);
const root = realpathSync(process.cwd()), out = `${root}/.paradev/shots-pitch-room`;
mkdirSync(out, { recursive: true });
const data = mkdtempSync(`${out}/fixture-`), office = activityOffice(data), errors = [], warnings = [], links = [], seen = new Set(), pages = new Map();
const project = { name: 'Plimbo', repo: 'owner/plimbo', hasMainLead: true, departmentLeads: [{ department: 'Marketing', title: 'Marketing lead', lead: 'marketing', leadStatus: { status: 'idle', updatedAt: Date.now() } }] };
let pitch;
const server = await createServer({ configFile: `${root}/vite.config.ts`, root: `${root}/src/client`, configLoader: 'runner', cacheDir: `${out}/vite`, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, realpathSync(`${root}/node_modules`)] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const push = (row, m) => row.ws?.send(JSON.stringify(m));
office.ctx.sendTo = (client, m) => { for (const row of pages.values()) if (row.client === client) push(row,m); };
office.ctx.warn = (_c, message) => warnings.push(message);
function publish() {
  for (const row of pages.values()) {
    push(row, { t: 'hq', view: hqView(office.ctx, office.ctx.floorOf(row.client), row.client) });
    push(row, { t: 'hq.leads', view: talkView(office.ctx, row.client) });
    push(row, { t: 'pitch', view: pitchView(office.ctx, office.ctx.floorOf(row.client), row.client) });
  }
}
function snapshot() { office.link.frame({ t: 'hq.snapshot', computerId: 'test-mac', observedAt: Date.now(), projects: [{ project, agents: [], ...(pitch ? { pitch } : {}) }] }); publish(); }
function respond() {
  for (const frame of office.link.sent.filter(m => m.t === 'lead.send' && !seen.has(m.id))) {
    seen.add(frame.id); links.push(frame);
    setTimeout(() => {
      office.link.frame({ t: 'lead.reply', id: frame.id, text: 'Who is the audience? What should they do? What constraints matter?' });
      if (frame.review?.kind === 'pitch') { const p = pitch.pieces.find(p => p.id === frame.review.pieceId); p.stamp = frame.review; snapshot(); }
      publish();
    }, 100);
  }
}
office.admit(); snapshot();
async function setup(page, role = 'owner', lite = false) {
  const row = { client: office.client(role), page }; pages.set(page,row);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Jonathan', color: '#1e40c8', look: { skin:0,hair:0,style:0 } }));
    localStorage.setItem('agent-office.settings', JSON.stringify({ muted:true,musicMuted:true,volume:0,music:0,view:'first' }));
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw Error('fixture'); };
  });
  await page.route('**/api/**', r => r.fulfill({ contentType:'application/json',body:'{}' }));
  await page.route('**/main.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body:(await response.text())+'\nwindow.__audit={ctx,core,parts};' }); });
  await page.route('**/lite.ts*', async r => { const response = await r.fetch(); await r.fulfill({ response, body:(await response.text())+'\nwindow.__lite={store,net};' }); });
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => {
    row.ws=ws; ws.onMessage(raw => {
      const m=JSON.parse(String(raw));
      try {
        if (pitchHandlers[m.t]) pitchHandlers[m.t](office.ctx,row.client,m);
        if (m.t==='hq.talk') sendTalk(office.ctx,row.client,m.lead,m.text);
        if (m.t.startsWith('pitch.') || m.t === 'hq.talk' || m.t === 'hq.leads.get' || m.t === 'hq.pitch') { publish(); respond(); }
      } catch (e) { warnings.push(e.message); }
    });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${lite?'lite.html':'?3d=1'}`);
  await page.waitForFunction(lite => lite ? window.__lite?.net.up : window.__office?.net.up && window.__audit, lite);
  await page.evaluate(([lite,role]) => {
    const s=lite?window.__lite.store:window.__office.store;
    s.floor='hq'; s.you='self'; s.me={admin:false,account:{id:role,name:role==='owner'?'Jonathan':'Ivan',role:'member'}};
    s.floors=[{id:'hq',hq:true,name:'HQ',dir:'/fixture',workers:0,people:1,busy:0,waiting:0,palette:0}];s.emit('floors');
    s.project={name:'HQ',dir:'/fixture',agentProviders:['claude'],defaultProvider:'claude'};
    if(!lite){const a=window.__audit,o=window.__office;a.core.upTop=false;a.core.trip=null;o.player.enabled=true;o.player.view='first';document.getElementById('loading')?.remove();document.getElementById('loading-screen')?.remove();o.sky.show({hour:12,weather:'clear'});}
  },[lite,role]);
  publish(); await page.waitForTimeout(400); return row;
}
async function stand(page,x,z,tx,tz,pitch=-.3){await page.evaluate(([x,z,tx,tz,pitch])=>{const p=window.__office.player;p.pos.set(x,0,z);p.vy=0;p.camYaw=Math.atan2(-(tx-x),-(tz-z));p.lookPitch=pitch;p.facing=p.camYaw+Math.PI;p.updateCamera(true);},[x,z,tx,tz,pitch]);await page.waitForTimeout(250);}
async function openTable(page) {await stand(page,13.7,9.3,13.7,10.75,-.65);await page.keyboard.press('KeyE');await page.getByRole('dialog',{name:'Pitch room',exact:true}).waitFor();}
const shot=async(page,name)=>{await page.waitForTimeout(300);await page.screenshot({path:`${out}/${name}.png`});};
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});await setup(page);await openTable(page);
  await page.getByText('Ask Plimbo lead to add a Design lead',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.pitch-departments button').allTextContents(),['Marketing','Design','Product','Growth/Sales','Support']);
  await page.getByRole('button',{name:'Marketing',exact:true}).click();
  await page.getByRole('dialog',{name:'Lead chat'}).waitFor();
  await page.waitForFunction(()=>window.__office.scene.getObjectByName('pitch-presenter')?.userData.walking===true);
  await stand(page,10.7,7.5,10.7,2,0);await page.waitForTimeout(3000);
  await shot(page,'01-walk-in-chat-desktop');
  assert.equal(links[0].target.department,0);assert.match(links[0].text,/Start a pitch brief for Plimbo Marketing/);
  await page.getByText('Who is the audience? What should they do? What constraints matter?',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Parents. Start a trial. No paid work yet.');
  await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForTimeout(400);
  assert.equal(links.at(-1).text,'Parents. Start a trial. No paid work yet.');
  await page.keyboard.press('Escape');await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>window.__office.player.hasMouse));
  pitch={department:'Marketing',lead:'Marketing lead',status:'building',version:'v1',pieces:[],brief:{title:'A calmer week',audience:'Parents',goal:'Start a trial',constraints:['No paid work yet']},directions:[{id:'a',title:'Gallery',summary:'A calm walk through the product.'},{id:'b',title:'Story',summary:'Follow a family through the week.'},{id:'c',title:'Demo',summary:'See the product in action.'}],budget:{session:10},costs:[{id:'one',tool:'Video tool',what:'One render',estimate:6,status:'asked'},{id:'two',tool:'Voice tool',what:'One voice call',estimate:5,status:'asked'}]};snapshot();
  await page.waitForFunction(()=>window.__office.scene.getObjectByName('pitch-brief-board')?.userData.lines.includes('A calmer week'));
  assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-flow-world').children.filter(o=>o.name.startsWith('pitch-direction-')).length),3);
  await stand(page,10.7,9,9.6,10.4,0);await shot(page,'02-glass-directions-desktop');
  await stand(page,10.7,10.45,9.5,10.45,.25);await page.keyboard.press('KeyE');await page.getByRole('dialog',{name:'Pitch room',exact:true}).waitFor();
  await page.locator('.pitch-direction').first().getByRole('button',{name:'Pick',exact:true}).click();
  await page.getByRole('button',{name:'Picked',exact:true}).waitFor();await page.waitForTimeout(200);
  assert.equal(links.at(-1).text,'Jonathan picked direction Gallery (a)');
  await page.locator('.pitch-cost').first().getByRole('button',{name:'OK',exact:true}).click();await page.waitForTimeout(300);
  assert.equal(links.at(-1).text,'Jonathan OKs cost one (One render, up to $6) for this one call');
  assert.equal(await page.locator('.pitch-cost').nth(1).getByRole('button',{name:'OK',exact:true}).isDisabled(),true);
  // Forged over-budget request still hits the real server gate.
  await page.evaluate(()=>window.__office.net.send({t:'pitch.action',project:'Plimbo',version:'v1',action:'ok',id:'two'}));await page.waitForTimeout(100);
  assert.match(warnings.at(-1),/remaining session budget/);
  office.link.frame({t:'hq.activity',target:{project:'Plimbo',department:0},doing:'editing home.ts',helpers:[{id:'a'.repeat(32),kind:'subagent',title:'Homepage helper',doing:'running tests'}]});publish();
  await page.getByText('Homepage helper · running tests',{exact:true}).waitFor();await shot(page,'03-brief-progress-costs-desktop');
  await page.keyboard.press('Escape');await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-helper-desks').children.filter(o=>o.visible).length),1);
  await stand(page,12.8,9,13.7,12.9,.14);
  assert.ok(await page.evaluate(()=>{const a=window.__audit.ctx.office.meetingBoard, b=window.__office.scene.getObjectByName('pitch-brief-board');return b.position.z<a.getWorldPosition(a.position.clone()).z;}),'private brief face must be in front of the shared board');
  await shot(page,'10-whiteboard-desktop');
  await page.waitForFunction(()=>window.__office.scene.getObjectByName('pitch-presenter')?.userData.walking===false,{},{timeout:20000});
  // The same phase-3 helpers light their positions on the project's own floor.
  pages.get(page).client.floorId='plimbo';
  await page.evaluate(()=>{const s=window.__office.store;s.floor='plimbo';s.hq=undefined;s.floors.push({id:'plimbo',name:'Plimbo',dir:'/fixture',workers:0,people:1,busy:0,waiting:0,palette:0});s.emit('floors');s.emit('floor');});publish();
  await page.waitForFunction(()=>window.__office.scene.getObjectByName('project-helper-'+ 'a'.repeat(32)));
  assert.equal(await page.evaluate(()=>window.__office.store.pitch.displayFloorId),'plimbo');
  assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-helper-desks').children.filter(o=>o.visible).length),1);
  await stand(page,-1.7,11,-4.05,10,-.35);await shot(page,'09-project-helper-desks-desktop');
  pages.get(page).client.floorId='hq';await page.evaluate(()=>{const s=window.__office.store;s.floor='hq';s.emit('floor');});publish();await page.waitForTimeout(300);

  // The live site plays on the wall in a sandboxed frame; served by a local route so no external site is called.
  await page.route('https://example.com/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Live Plimbo</h1>'}));
  pitch.status='ready';pitch.pieces=[{id:'home',kind:'site',title:'Home page',url:'https://example.com/v1',images:[],notes:['Versioned site']},{id:'slides',kind:'slides',title:'Launch deck',images:[],notes:[]}];snapshot();pitchChanged(office.ctx);
  await page.getByText('Pitch ready: Plimbo Marketing',{exact:false}).waitFor();await shot(page,'04-ready-alert-desktop');await page.getByRole('button',{name:'Go there',exact:true}).click();
  await page.waitForTimeout(1600);assert.ok(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-room').userData.dim<.4));
  assert.ok(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-follow-spotlight').intensity>0));
  await stand(page,14.3,9.3,16.1,9.5,.08);
  const frame=page.locator('.pitch-site-frame iframe');await frame.waitFor({state:'attached'});
  assert.equal(await frame.getAttribute('src'),'https://example.com/v1');assert.equal(await frame.getAttribute('sandbox'),'allow-scripts allow-same-origin allow-forms');assert.equal(await frame.getAttribute('referrerpolicy'),'no-referrer');
  await page.waitForTimeout(1500);
  const live=page.frames().find(f=>f.url()==='https://example.com/v1');assert.ok(live,'live site frame loaded');assert.equal(await live.locator('h1').innerText(),'Live Plimbo');
  assert.ok(await page.evaluate(()=>{const f=window.__office.scene.getObjectByName('pitch-face-site');return f.material.opacity===0&&!f.parent.getObjectByName('pitch-placeholder')?.visible;}),'the wall opens onto the live page and its placeholder hides');
  await shot(page,'11-live-site-desktop');
  await page.keyboard.press('KeyE');await page.getByRole('dialog',{name:'Pitch review'}).waitFor();
  assert.equal(await page.getByRole('link',{name:/Open site/}).getAttribute('href'),'https://example.com/v1');
  await page.getByRole('button',{name:'Approve',exact:true}).click();await page.waitForTimeout(300);assert.equal(links.at(-1).review.verdict,'approve');await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.__office.scene.getObjectByName('pitch-presenter').userData.walking),false);await shot(page,'05-ready-show-desktop');
  const phone=await browser.newPage({viewport:{width:390,height:844}});await setup(phone,'owner',true);
  assert.equal(await phone.locator('.pitch-direction').count(),3);assert.equal(await phone.locator('.pitch-cost').count(),2);assert.equal(await phone.locator('.pitch-list li').count(),2);
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(phone,'06-lite-phone');
  await phone.locator('.pitch-progress').scrollIntoViewIfNeeded();await shot(phone,'07-lite-progress-phone');
  await phone.locator('.pitch-cost').nth(1).getByRole('button',{name:'Decline',exact:true}).click();await phone.waitForTimeout(300);assert.equal(links.at(-1).text,'Jonathan declines cost two');
  const manager=await browser.newPage({viewport:{width:1280,height:800}});await setup(manager,'manager');await openTable(manager);
  assert.equal(await manager.locator('.pitch-flow button:not([disabled])').count(),0);await shot(manager,'08-manager-desktop');
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/pitch-room-results.json`,JSON.stringify({checks:'department picker, same-identity walk-in, chat round trip, brief board, three glass directions, Pick, live helpers and glow, budget and server refusal, once-ready alert, Go there, dimming and spotlight, versioned site fallback, verdict, reduced motion, phone list, manager read-only',links:links.map(f=>({target:f.target,text:f.text})),warnings,errors,blocked:'Live site iframe: existing TV has no sandbox or general site allow-list policy.'},null,2));
  console.log(`Pitch room UI passed; screenshots in ${out}`);
} catch (e) { for (const [p] of pages) { await p.screenshot({path:`${out}/failure.png`}); console.log(await p.evaluate(()=>({text:document.body.innerText.slice(-4000), hq:window.__office?.store.hq, talk:window.__office?.store.leadTalk, flow:window.__office?.scene.getObjectByName('pitch-flow-world')?.children.map(c=>({name:c.name,position:c.position.toArray()}))}))); } throw e; } finally {await browser.close();await server.close();office.close();rmSync(data,{recursive:true,force:true});}
