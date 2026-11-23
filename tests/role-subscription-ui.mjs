// Real approval component, fake structured request transport. No provider or production server.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.CONSENT_UI_OUTPUT ?? '/tmp/agent-office-consent-ui'; mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.route('**/__consent_preview.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="modal-root"></div><script type="module">
import '/ui/departments.css';import {roleSubscription} from '/ui/role-subscription.ts';import {store} from '/state/index.ts';import {h,openModal} from '/ui/dom.ts';
store.floor='plimbo';window.sent=[];const listeners=new Set();const net={up:true,send:m=>window.sent.push(m),onMessage:f=>{listeners.add(f);return()=>listeners.delete(f)},onStatus:f=>()=>{}};
const component=roleSubscription(net,'dev');openModal(h('div.modal.roles',{role:'dialog','aria-label':'Roles'},h('header',{},h('h2',{},'Roles · Development')),component.element),{onClose:component.close});
window.receive=m=>{for(const f of listeners)f(m)};window.state={floor:'plimbo',department:'dev',project:'Plimbo',departmentName:'Development',provider:'kimi',custodian:'payer@example.test',controllers:['ivan@example.test','eddie@example.test'],active:false,canConsent:true,configuration:'exact-scope',audience:[],allowStaffQA:false,allowWorkers:false,reason:'Custodian consent pending.'};window.receive({t:'role.subscription.state',state:window.state});
</script>`}));
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5198/__consent_preview.html');
  const allow=page.getByRole('button',{name:'Allow these controllers to use my subscription'});await allow.waitFor();
  assert.equal(await page.getByRole('checkbox').isChecked(),false);await allow.click();assert.equal(await allow.isDisabled(),true);
  assert.equal(await page.getByText('Saving consent…',{exact:true}).count(),1);
  await page.evaluate(()=>window.receive({t:'role.subscription.state',error:'The controller list changed. Review again.',state:window.state}));
  assert.equal(await allow.isEnabled(),true);await page.getByText('The controller list changed. Review again.',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:out+'/consent-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({animations:'disabled',path:out+'/consent-mobile.png'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('checkbox').check();await allow.click();assert.equal((await page.evaluate(()=>window.sent)).at(-1).allowStaffQA,true);
  await page.evaluate(()=>window.receive({t:'role.subscription.state',state:{...window.state,active:true,allowStaffQA:true}}));
  await page.getByRole('button',{name:'Revoke shared subscription use'}).click();assert.equal((await page.evaluate(()=>window.sent)).at(-1).allow,false);
  await page.evaluate(()=>window.receive({t:'role.subscription.state',state:{...window.state,canConsent:false}}));assert.equal(await allow.isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
  console.log('Role subscription actual UI passed; screenshots '+out);
} finally {await browser.close();await server.close();}
