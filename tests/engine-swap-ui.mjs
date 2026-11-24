// Real approval component, fake structured request transport. No provider or production server.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.SWAP_UI_OUTPUT ?? '/tmp/agent-office-swap-ui'; mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.route('**/__swap_preview.html', route => route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="modal-root"></div><div id="toasts"></div><script type="module">
import '/ui/departments.css';import {openEngineSwap} from '/ui/engine-swap.ts';import {store} from '/state/index.ts';
const listeners=new Set(), statuses=new Set();window.sent=[];
const net={up:true,send:m=>window.sent.push(m),onMessage:f=>{listeners.add(f);return()=>listeners.delete(f)},onStatus:f=>{statuses.add(f);return()=>statuses.delete(f)}};
const handoff={id:'h1',state:'pending',prompt:'Continue the approved project work.',to:'replacement'};
store.workers.set('source',{id:'source',name:'CEO',provider:'claude',status:'done',handoff,swap:{engine:'codex',replacementId:'replacement'}});
window.openSwap=()=>openEngineSwap(net,'source');window.receive=m=>{if(m.t==='worker.update')store.workers.set(m.worker.id,m.worker);for(const f of listeners)f(m)};
window.delivered=()=>{handoff.state='acknowledged';};window.disconnect=()=>{net.up=false;for(const f of statuses)f(false)};window.reconnect=()=>{net.up=true;for(const f of statuses)f(true)};
window.openSwap();</script>`}));
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5198/__swap_preview.html');
  const ack=page.getByRole('button',{name:'Acknowledge context and send once',exact:true});await ack.click();
  assert.equal(await page.getByRole('dialog').count(),1,'no optimistic close');assert.equal(await ack.isDisabled(),true);
  await page.evaluate(()=>window.receive({t:'handoff.result',workerId:'wrong',handoffId:'h1',action:'ack',ok:true}));
  assert.equal(await page.getByRole('dialog').count(),1,'wrong worker ignored');
  await page.evaluate(()=>{window.delivered();window.receive({t:'handoff.result',workerId:'source',handoffId:'h1',action:'ack',ok:false,error:'History save failed. Retry.',handoff:{id:'h1',state:'acknowledged',prompt:'Continue the approved project work.'}})});
  await page.getByText('History save failed. Retry.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Finish role swap',exact:true}).isEnabled(),true);
  await page.screenshot({animations:'disabled',path:out+'/swap-desktop.png'});
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>window.openSwap());await page.getByRole('button',{name:'Finish role swap',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:out+'/swap-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>window.disconnect());assert.equal(await page.getByRole('button',{name:'Finish role swap',exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.reconnect());await page.getByRole('button',{name:'Finish role swap',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.evaluate(()=>window.receive({t:'handoff.result',workerId:'source',handoffId:'stale',action:'ack',ok:true}));assert.equal(await page.getByRole('dialog').count(),1);
  await page.evaluate(()=>window.receive({t:'handoff.result',workerId:'source',handoffId:'h1',action:'ack',ok:true}));assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.sent),[{t:'handoff.ack',workerId:'source',handoffId:'h1'},{t:'handoff.ack',workerId:'source',handoffId:'h1'}]);
  assert.deepEqual(errors,[]);console.log('Engine swap actual UI regression passed; screenshots: '+out);
} finally {await browser.close();await server.close();}
