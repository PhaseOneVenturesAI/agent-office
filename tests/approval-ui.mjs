// Real approval component, fake structured request transport. No provider or production server.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.APPROVAL_UI_OUTPUT ?? '/tmp/agent-office-approval-ui'; mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.route('**/__approval_preview.html', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="modal-root"></div><script type="module">
import {openWorkerConversation} from '/ui/worker-conversation.ts'; import {store} from '/state/index.ts';
const listeners=new Set(),statuses=new Set();window.sent=[];window.terminalOpened=false;
const net={up:true,send:m=>window.sent.push(m),onMessage:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},onStatus:fn=>{statuses.add(fn);return()=>statuses.delete(fn);}};
store.floor='floor';store.workers.set('pixel',{id:'pixel',name:'Pixel',provider:'kimi',status:'needs_input',kind:'agent',viewers:[],viewerIds:[]});
openWorkerConversation(net,'pixel',()=>window.terminalOpened=true);
window.receive=m=>{for(const fn of listeners)fn(m);};window.disconnect=()=>{net.up=false;for(const fn of statuses)fn(false);};
window.receive({t:'conversation.state',workerId:'pixel',supported:true,messages:[{id:'reply',role:'assistant',at:Date.now(),text:'I’m ready to run the focused tests. Please review the command below.'}]});
window.receive({t:'approval.state',workerId:'pixel',state:{queued:2,request:{id:'occurrence-1',nativeRequestId:'rpc-42',source:'acp',provider:'kimi',sessionId:'session',title:'Run focused regression checks',detail:JSON.stringify({command:'npm test -- --test-name-pattern="approval"',cwd:'/project/agent-office'},null,2),options:[{id:'permit-once',label:'Allow once',kind:'allow_once'},{id:'reject',label:'Deny',kind:'reject_once'}]}}});
</script></body></html>` }));
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('http://127.0.0.1:5198/__approval_preview.html');
  await page.getByRole('button', { name: 'Allow once', exact: true }).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  await page.screenshot({ animations:'disabled', path:`${out}/approval-desktop.png` });
  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.screenshot({ animations:'disabled', path:`${out}/approval-mobile.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button',{name:'Allow once',exact:true}).click();
  const sent=await page.evaluate(()=>window.sent); assert.deepEqual(sent.at(-1),{t:'approval.answer',workerId:'pixel',requestId:'occurrence-1',optionId:'permit-once'});
  assert.equal(await page.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.receive({t:'approval.result',workerId:'pixel',requestId:'occurrence-1',error:'Your approval access changed; no decision was submitted'}));
  await page.getByText('Your approval access changed; no decision was submitted',{exact:true}).waitFor();
  await page.evaluate(()=>window.disconnect()); assert.equal(await page.getByRole('button',{name:'Allow once',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(),0);
  assert.ok((await page.evaluate(()=>window.sent)).some(m=>m.t==='approval.close'));  assert.deepEqual(errors,[]);
  console.log('Approval UI passed; screenshots: '+out);
} finally { await browser.close(); await server.close(); }
