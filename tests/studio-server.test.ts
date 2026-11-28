import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { talkView } from '../src/server/hq/talk-views.js';
import { hqView } from '../src/server/hq/views.js';
import { studioFixture as fixture } from './support/studio.js';
test('Cloudflare owner only, admitted node only, wrong result rejected; draft metadata has no git and is invisible to managers/coworkers',async t=>{
  const f=fixture(t), id=randomUUID(), frame={t:'studio.new' as const,id,name:'Studio Test'};
  for(const c of [f.manager,f.coworker,{...f.owner,accountId:undefined}]) assert.throws(()=>f.studio.submit(c,frame),/Only the HQ owner/);
  const cf=f.ctx.cloudflare;f.ctx.cloudflare=undefined;assert.throws(()=>f.studio.submit(f.owner,frame),/Cloudflare/);f.ctx.cloudflare=cf;
  assert.throws(()=>f.studio.submit(f.owner,frame),/offline/);
  f.admit();f.studio.submit(f.owner,frame); assert.equal(f.ws.sent.at(-1).t,'project.new');
  await f.studio.accept('wrong','owner',{t:'project.result',id,ok:true,detail:'Ready',project:'Studio Test'});assert.equal(f.ctx.floors.size,1);
  f.snapshot();const draft=f.building.list().find(d=>d.draft)!;assert.ok(draft);assert.equal(existsSync(path.join(draft.dir,'.git')),false);
  assert.equal(f.ctx.floorVisible(draft.id,f.owner),true);for(const c of [f.manager,f.coworker]) { assert.equal(f.ctx.floorVisible(draft.id,c),false);assert.ok(!f.ctx.floorInfos(c).some(d=>d.id===draft.id));assert.ok(!JSON.stringify(talkView(f.ctx,c)).includes('Studio Test')); }
  assert.ok(!JSON.stringify(hqView(f.ctx,f.ctx.floors.get('hq'),f.manager)).includes('Studio Test'));
  const view=f.studio.state(draft.id,'owner',{enabled:false,canStart:false});assert.equal(view.here?.studio,true);assert.equal(view.here?.boards.ideas[0].title,'One inbox');assert.equal(view.here?.boards.screens[0].version,2);
  await f.studio.accept(f.ws.sent.find(m=>m.t==='hq.ready') ? (f.ctx.hq.mac!.projectNode('owner')!) : '', 'owner',{t:'project.result',id,ok:true,detail:'Ready',project:'Studio Test'});
  assert.ok(f.sent.some(m=>m.t==='project.result'&&m.floorId===draft.id));
});
test('feedback including selected version uses normal lead.send; confirmation mismatch never relayed',t=>{
  const f=fixture(t);f.admit();f.snapshot();
  for(const c of [f.manager,f.coworker])assert.throws(()=>f.studio.submit(c,{t:'studio.feedback',project:'Studio Test',cardId:'idea',text:'👍'}),/Only/);
  f.studio.submit(f.owner,{t:'studio.feedback',project:'Studio Test',cardId:'home-v2',text:'Approve'});
  const send=f.ws.sent.at(-1);assert.equal(send.t,'lead.send');assert.deepEqual(send.target,{project:'Studio Test'});assert.match(send.text,/Home v2.*Approve/);
  assert.throws(()=>f.studio.submit(f.owner,{t:'studio.open',id:randomUUID(),project:'Studio Test',confirm:'studio test'}),/exact confirmation/);
});
test('open/add create or reuse exactly one public floor, retain Design metadata and New badge; same lead thread survives',async t=>{
  const f=fixture(t);f.admit();f.snapshot();let adds=0;
  f.building.add=async(repo,by)=>{adds++;await new Promise(r=>setTimeout(r,5)); const dir=path.join(f.dir,'fake-repo');mkdirSync(dir);return f.building.addLocal({id:'public',dir,repo,name:'Studio Test',addedBy:by,addedAt:Date.now()});};
  f.studio.submit(f.owner,{t:'studio.feedback',project:'Studio Test',cardId:'idea',text:'👍'});
  const turn=f.ws.sent.at(-1); f.ws.frame({t:'lead.reply',id:turn.id,text:'Recorded'});
  const result={t:'project.result' as const,id:randomUUID(),ok:true,detail:'Ready',project:'Studio Test',repo:'PhaseOneVenturesAI/studio-test'};
  const [a,b]=await Promise.all([f.studio.publicFloor('owner',result),f.studio.publicFloor('owner',result)]);assert.equal(a.id,b.id);assert.equal(adds,1);
  await f.studio.publicFloor('owner',result);assert.equal(adds,1);assert.equal(f.ctx.floorVisible(a.id,f.coworker),true);assert.equal(f.studio.isNew(a.id),true);assert.equal(f.ctx.floorInfos(f.coworker).find(d=>d.id===a.id)?.isNew,true);assert.equal(f.studio.state(a.id,'coworker',{enabled:false,canStart:false}).launched?.repo,result.repo);
  assert.equal(f.ctx.hq.mac!.talk.view('owner','project:phaseoneventuresai/studio-test:ceo','owner')?.at(-1)?.text,'Recorded');
  assert.equal(f.sent.filter(m=>m.t==='gong').length,1);assert.equal(f.building.list().filter(d=>d.repo===result.repo).length,1);assert.equal(f.building.list().filter(d=>d.draft).length,0);
});

test('a full building cannot turn an admitted snapshot into an uncaught server error', t => {
  const f=fixture(t);f.admit();f.ctx.openFloor=()=>{throw Error('Full');};
  assert.doesNotThrow(()=>f.snapshot());
});
