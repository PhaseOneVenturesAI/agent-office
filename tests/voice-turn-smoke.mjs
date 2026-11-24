import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo=process.cwd();
const out=path.resolve(process.env.VOICE_UI_OUTPUT || '/tmp/office-turn-voice-smoke')+'/';mkdirSync(out,{recursive:true});
const require=createRequire(repo+'/package.json');
const {build}=require('esbuild'),{chromium}=require('playwright-core');
const bundle=await build({stdin:{contents:`import {Voice} from '${repo}/src/client/voice.ts';window.voice=new Voice({up:true,onStatus:f=>{window.netStatus=f;},onMessage:f=>{window.netMessage=f;},send:m=>{if(m.t==='voice.ice'){queueMicrotask(()=>window.netMessage({t:'voice.ice',requestId:m.requestId,ice:[],expiresAt:Date.now()+3600000}));}else window.signal(m);}});window.ready=true;`,resolveDir:repo,loader:'ts'},bundle:true,write:false,format:'iife',plugins:[{name:'test-state',setup(b){b.onResolve({filter:/^\.\/state$/},()=>({path:'state',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const store=window.testStore;',loader:'js'}));}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/voice.js'?'application/javascript':'text/html');res.end(req.url==='/voice.js'?bundle.outputFiles[0].text:'<!doctype html><title>Office synthetic voice smoke</title><script src="/voice.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio']});
const pages={},errors=[],evidence={sourceCommit:process.env.SOURCE_COMMIT || 'working tree',syntheticMicrophones:true,realMicrophoneAccess:false,captureFixture:'WebAudio oscillator MediaStream; real getUserMedia/device permissions not tested',steps:[]};
async function stats(id){return pages[id].evaluate(async()=>{const c=[...voice.conns.values()][0],report=c?await c.pc.getStats():new Map();const inbound=[...report.values()].find(x=>x.type==='inbound-rtp'&&x.kind==='audio');return {inVoice:voice.inVoice,muted:voice.muted,trackLive:voice.mic?.getAudioTracks()[0]?.readyState,trackEnabled:voice.mic?.getAudioTracks()[0]?.enabled,connection:c?.pc.connectionState,ice:c?.pc.iceConnectionState,inboundBytes:inbound?.bytesReceived??0,energy:inbound?.totalAudioEnergy??0,level:c?.level??0,volume:c?.audio.volume,paused:c?.audio.paused,audioContext:voice.audioCtx?.state};});}
async function until(check,message,ms=10000){const end=Date.now()+ms;while(!(await check())){if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,100));}}
const watchdog=setTimeout(()=>{console.log('Test watchdog: closing synthetic browsers');void browser.close();},30000);
try{
 console.log('Creating synthetic pages');
 for(const id of ['a','b']){const context=await browser.newContext({permissions:['microphone']});const page=pages[id]=await context.newPage();page.on('pageerror',e=>errors.push(id+': '+e.message));page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')errors.push(id+': '+m.text());});await page.exposeFunction('signal',async m=>{if(m.t==='rtc'&&pages[m.to])await pages[m.to].evaluate(({from,data})=>voice.handleSignal(from,data),{from:id,data:m.data});});await page.addInitScript(({id})=>{navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext();const oscillator=context.createOscillator();oscillator.frequency.value=id==='a'?440:660;const gain=context.createGain();gain.gain.value=0.15;const destination=context.createMediaStreamDestination();oscillator.connect(gain).connect(destination);oscillator.start();await context.resume();window.syntheticContext=context;return destination.stream;};window.testStore={you:id,ice:[],peers:new Map([['a',{id:'a',lite:false,floor:'project'}],['b',{id:'b',lite:false,floor:'project'}]])};},{id});await page.goto(url);await page.waitForFunction(()=>window.ready);}
 console.log('Joining synthetic microphones');
 for(const page of Object.values(pages))assert.equal(await page.evaluate(()=>voice.joinVoice()),null);
 console.log('Synchronizing peers');
 for(const page of Object.values(pages))await page.evaluate(()=>voice.syncPeers());
 await until(async()=>{const a=await stats('a'),b=await stats('b');return a.inboundBytes>0&&b.inboundBytes>0&&a.energy>0&&b.energy>0;},'bidirectional audio never arrived');
 evidence.steps.push({step:'join-bidirectional',a:await stats('a'),b:await stats('b')});
 for(const page of Object.values(pages))await page.evaluate(async()=>{
   window.restarts=0;
   for(const c of voice.conns.values()){const orig=c.pc.restartIce.bind(c.pc);c.pc.restartIce=()=>{window.restarts++;orig();};}
   voice.ice.now=()=>Date.now()+3500000;
   await voice.ice.ready();
 });
 await new Promise(r=>setTimeout(r,200));
 for(const page of Object.values(pages))assert.equal(await page.evaluate(()=>window.restarts),0);
 evidence.steps.push({step:'credential-refresh-healthy-direct',noIceRestarts:true,a:await stats('a'),b:await stats('b')});

 await pages.a.evaluate(()=>voice.setMuted(true));assert.equal((await stats('a')).trackEnabled,false);await new Promise(r=>setTimeout(r,500));evidence.steps.push({step:'mute',a:await stats('a'),b:await stats('b')});
 await pages.a.evaluate(()=>voice.setMuted(false));assert.equal((await stats('a')).trackEnabled,true);const prior=(await stats('b')).energy;await until(async()=>(await stats('b')).energy>prior,'unmuted audio did not resume');evidence.steps.push({step:'unmute',a:await stats('a'),b:await stats('b')});
 await pages.a.evaluate(()=>voice.setVolume('b',0));assert.equal((await stats('a')).volume,0);await pages.a.evaluate(()=>voice.setVolume('b',1));assert.equal((await stats('a')).volume,1);evidence.steps.push({step:'floor-volume-controls',volumeZeroAndRestore:true});
 for(const page of Object.values(pages))await page.evaluate(()=>voice.reset());
 console.log('Synchronizing peers');
 for(const page of Object.values(pages))await page.evaluate(()=>voice.syncPeers());
 await until(async()=>{const a=await stats('a'),b=await stats('b');return a.inboundBytes>0&&b.inboundBytes>0&&a.energy>0&&b.energy>0;},'audio failed after reset/reconnect');
 evidence.steps.push({step:'reset-reconnect',a:await stats('a'),b:await stats('b')});
 evidence.result='passed';
}catch(e){evidence.result='failed';evidence.error=e.stack;process.exitCode=1;}finally{clearTimeout(watchdog);evidence.browserErrors=errors;writeFileSync(out+'result.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await browser.close();server.close();}
