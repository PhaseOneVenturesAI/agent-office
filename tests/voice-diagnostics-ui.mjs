// Real Voice + notice components with a mocked browser peer: no microphone, live login or TURN traffic.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.VOICE_UI_OUTPUT ?? '/tmp/agent-office-voice-details'; mkdirSync(out, { recursive: true });
const server = await createServer({ cacheDir: '/tmp/agent-office-voice-vite', server: { host: '127.0.0.1', port: 5199, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.route('**/__voice_preview.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="hud"><div id="toasts"></div></div><div id="modal-root"></div><script type="module">
import {Voice} from '/voice.ts'; import {installVoice} from '/features/voice/index.ts'; import {store} from '/state/index.ts';
window.copied=[];window.sent=[];
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied.push(text)}}});
class Peer {
 constructor(config){this.config=config;this.listeners={};this.connectionState='new';this.iceConnectionState='new';this.iceGatheringState='complete';this.signalingState='stable'}
 addEventListener(name,fn){this.listeners[name]=fn}
 getConfiguration(){return this.config}
 getStats(){return Promise.resolve(new Map())}
 close(){this.connectionState='closed'}
}
window.RTCPeerConnection=Peer;
const listeners=new Set(),net={up:true,onStatus(){},onMessage:fn=>listeners.add(fn),send:msg=>{window.sent.push(msg);if(msg.t==='voice.ice')queueMicrotask(()=>listeners.forEach(fn=>fn({t:'voice.ice',requestId:msg.requestId,ice:[{urls:'turn:private-relay.example:3478',username:'private-user',credential:'private-password'}],expiresAt:Date.now()+3600000})))} };
const voice=new Voice(net);window.voice=voice;
store.you='me';store.ice=[];store.peers.set('coworker-private-id',{id:'coworker-private-id',name:'Ivan',lite:false});
installVoice({voice,keys:{bind(){}},messages:{on(){}},settings:{},hud:{refresh(){}}},{tv:{show(){}}});
listeners.forEach(fn=>fn({t:'welcome',version:'e9540fe'}));
await voice.syncPeers();
window.fail=(name='Ivan')=>{store.peers.get('coworker-private-id').name=name;const pc=voice.conns.get('coworker-private-id').pc;pc.connectionState='failed';pc.iceConnectionState='failed';pc.listeners.icecandidateerror({errorCode:701,errorText:'private-user 192.168.1.42',url:'turn:private-relay.example'});pc.onconnectionstatechange()};
window.fail();window.ready=true;
</script></body></html>` }));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('http://127.0.0.1:5199/__voice_preview.html');
  const notice = page.getByRole('region', { name: 'Voice connection problem' });
  const copy = notice.getByRole('button', { name: 'Copy details', exact: true });
  await copy.waitFor(); await page.waitForFunction(() => !document.querySelector('.voice-failure-actions button').disabled);
  assert.doesNotMatch(await notice.innerText(), /needs a TURN server|blocks direct calls/);
  await page.screenshot({ animations: 'disabled', path: `${out}/voice-failure-desktop.png` });
  const before = await page.evaluate(() => window.sent.length);
  await copy.click();
  const text = await page.evaluate(() => window.copied.at(-1));
  const details = JSON.parse(text);
  assert.equal(details.states.connection, 'failed'); assert.equal(details.issuer.request, 'received');
  assert.deepEqual(details.relay, { configured: true, localCandidateObserved: false, selected: null });
  assert.deepEqual(details.candidateErrorCodes, [701]);
  for (const secret of ['private-user','private-password','private-relay','coworker-private-id','192.168','Ivan']) assert.ok(!text.includes(secret), `must not copy ${secret}`);
  assert.equal(await page.evaluate(() => window.sent.length), before, 'copy must not send telemetry');
  await page.evaluate(() => window.fail('Keven'));
  assert.equal(await notice.count(), 1, 'concurrent peer failures must not stack notices');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ animations: 'disabled', path: `${out}/voice-failure-phone.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'notice fits phone');
  await page.evaluate(() => { navigator.clipboard.writeText=async()=>{throw new Error('denied')} });
  await copy.click();
  const dialog = page.getByRole('dialog', { name: 'Copy voice connection details' });
  await dialog.waitFor();
  assert.match(await dialog.getByRole('textbox', { name: 'Voice connection details' }).inputValue(), /"configured": true/);
  await page.screenshot({ animations: 'disabled', path: `${out}/voice-details-phone.png` });
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  await copy.click(); await dialog.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(await dialog.count(), 0);
  await notice.getByRole('button', { name: 'Dismiss voice connection notice' }).click(); assert.equal(await notice.count(), 0);
  assert.deepEqual(errors, []);
  console.log(`Voice diagnostics UI checks passed; screenshots: ${out}`);
} finally { await browser.close(); await server.close(); }
