import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { turnConfig, issueTurn } from '../src/server/turn.js';
import { voiceIceHandlers } from '../src/server/ws/handlers/voice-ice.js';
import { childEnv } from '../src/server/workers/env.js';
import { VoiceIce, refreshPeerIce } from '../src/client/voice-ice.js';
const secret = 'test-only-secret-at-least-thirty-two-characters';
const cfg = { urls: ['turn:relay.example:3478?transport=udp'], secret, ttl: 3600 };

test('coturn timestamp/HMAC credentials expire and do not disclose identity or signing secret', () => {
 const result=issueTurn(cfg,'private@example.test',1_000_000), ice=result.ice[0];
 assert.equal(result.expiresAt,4_600_000);
 assert.equal(ice.credential,createHmac('sha1',secret).update(ice.username).digest('base64'));
 assert.equal(ice.username.split(':')[0],'4600');
 assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes('private@'));
 assert.notEqual(issueTurn(cfg,'other',1_000_000).ice[0].username,ice.username);
 assert.notEqual(issueTurn(cfg,'private@example.test',2_000_000).ice[0].credential,ice.credential);
});
test('expiring config rejects incomplete, embedded credentials and unsafe TTL; static-only unchanged',()=>{
 assert.equal(turnConfig({}),undefined);
 for(const env of [{AGENT_OFFICE_TURN_SECRET:secret},{AGENT_OFFICE_TURN_URLS:'turn:host'}, {AGENT_OFFICE_TURN_URLS:'turn:user:pass@host',AGENT_OFFICE_TURN_SECRET:secret},{AGENT_OFFICE_TURN_URLS:'turn:user:pass',AGENT_OFFICE_TURN_SECRET:secret},{AGENT_OFFICE_TURN_URLS:'turn:host',AGENT_OFFICE_TURN_SECRET:secret,AGENT_OFFICE_TURN_TTL:'30'}]) assert.throws(()=>turnConfig(env));
 assert.equal(turnConfig({AGENT_OFFICE_TURN_URLS:'turn:host:3478 turns:host:5349?transport=tcp',AGENT_OFFICE_TURN_SECRET:secret})?.urls.length,2);
});
test('TURN secret never inherited by provider or shell child environment',()=>{
 const previous=process.env.AGENT_OFFICE_TURN_SECRET;process.env.AGENT_OFFICE_TURN_SECRET=secret;
 try{assert.equal(childEnv().AGENT_OFFICE_TURN_SECRET,undefined);}finally{if(previous===undefined)delete process.env.AGENT_OFFICE_TURN_SECRET;else process.env.AGENT_OFFICE_TURN_SECRET=previous;}
});
test('authenticated relay issuance rechecks account/connection, denies lite, throttles, preserves static ICE',()=>{
 const sent:any[]=[];let account=true,inside=true;
 const ctx:any={cfg:{turn:cfg,iceServers:[{urls:'stun:existing'}]},accounts:{get:()=>account,sharedPassword:true},stillIn:()=>inside,sendTo:(_:any,m:any)=>sent.push(m)};
 const c:any={id:'session',accountId:'a',peer:{},throttles:new Map()};
 const ask=()=>voiceIceHandlers['voice.ice'](ctx,c,{t:'voice.ice',requestId:'request'});
 ask();assert.equal(sent[0].ice.length,2);assert.equal(sent[0].ice[0].urls,'stun:existing');ask();assert.equal(sent.length,1);
 account=false;ask();assert.match(sent.at(-1).error,/Sign in/);assert.equal(sent.at(-1).ice.length,0);
 account=true;inside=false;ask();assert.ok(sent.at(-1).error);inside=true;c.peer.lite=true;ask();assert.ok(sent.at(-1).error);
 c.peer.lite=false;c.out=true;ask();assert.ok(sent.at(-1).error);
});
function client(){
 let now=1000000;const sent:any[]=[];let message:any,status:any;const updates:any[]=[];
 const net:any={up:true,send:(m:any)=>sent.push(m),onMessage:(f:any)=>message=f,onStatus:(f:any)=>status=f};
 const ice=new VoiceIce(net,()=>[{urls:'stun:static'}],v=>updates.push(v),()=>now);
 return{ice,net,sent,updates,reply:(extra:any={})=>message({t:'voice.ice',requestId:sent.at(-1).requestId,ice:[{urls:'turn:relay',username:'u',credential:'p'}],expiresAt:now+3600000,...extra}),advance:(ms:number)=>now+=ms,disconnect:()=>{net.up=false;status(false)}};
}
test('client deduplicates pending refresh, ignores stale response, expires credentials, clears on disconnect',async()=>{
 const f=client();const first=f.ice.ready(),second=f.ice.ready();assert.equal(f.sent.length,1);
 f.reply({requestId:'wrong'});assert.equal(f.updates.length,0);f.reply();await Promise.all([first,second]);
 assert.equal(f.ice.servers()[0].urls,'turn:relay');await f.ice.ready();assert.equal(f.sent.length,1);
 f.advance(3600001);assert.equal(f.ice.servers()[0].urls,'stun:static');const pending=f.ice.ready();assert.equal(f.sent.length,2);
 f.disconnect();await pending;f.reply();assert.equal(f.ice.servers()[0].urls,'stun:static');assert.equal(f.updates.length,1);f.ice.stop();
});
test('denied renewal never retains expired relay credentials; static fallback still works',async()=>{
 const f=client();const pending=f.ice.ready();f.reply({error:'Signed out',ice:[],expiresAt:undefined});await pending;
 assert.equal(f.ice.servers()[0].urls,'stun:static');assert.equal(f.updates.length,0);f.ice.stop();
});
test('refresh updates configuration but only restarts relay-selected or failed peers',async()=>{
 for(const type of ['host','srflx','relay']){
  let restarts=0,updated:any;const stats=new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{localCandidateId:'local'}],['local',{candidateType:type}]]);
  const pc:any={connectionState:'connected',iceConnectionState:'connected',getConfiguration:()=>({bundlePolicy:'max-bundle'}),setConfiguration:(c:any)=>updated=c,getStats:async()=>stats,restartIce:()=>restarts++};
  await refreshPeerIce(pc,[{urls:'turn:new'}]);assert.equal(updated.bundlePolicy,'max-bundle');assert.equal(restarts,type==='relay'?1:0);
 }
});
test('refresh timer renews before expiry, retry is bounded, and disconnect clears scheduled work',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=client();let pending=f.ice.ready();f.reply();await pending;
 f.advance(3480000);t.mock.timers.tick(3480000);assert.equal(f.sent.length,2);
 f.reply();await Promise.resolve();f.disconnect();f.advance(3600000);t.mock.timers.tick(3600000);assert.equal(f.sent.length,2);
 const g=client();void g.ice.ready();
 for(let i=0;i<3;i++){g.advance(3000);t.mock.timers.tick(3000);g.advance(15000);t.mock.timers.tick(15000);}
 assert.equal(g.sent.length,3);g.advance(900000);t.mock.timers.tick(900000);assert.equal(g.sent.length,3);g.ice.stop();
});
