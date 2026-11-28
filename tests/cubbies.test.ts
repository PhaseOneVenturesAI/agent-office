import { legacyCubby } from './support/legacy-cubby.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Nodes } from '../src/server/nodes.js';
import { Cubbies } from '../src/server/cubbies/index.js';
import { cubbiesHandlers } from '../src/server/ws/handlers/cubbies.js';
import { cubbyKey, verifyRelay } from '../src/server/cubbies/wire.js';
const message = (text: string) => ({ text, requestId: randomUUID(), at: Date.now(), ownerSig: 'A'.repeat(86) });
function socket() {
  const events = new Map<string, Function[]>();
  return { readyState: 1, bufferedAmount: 0, sent: [] as any[], close() { this.readyState = 3; this.emit('close'); },
    on(e: string, f: Function) { events.set(e, [...events.get(e) ?? [], f]); },
    emit(e: string, ...args: any[]) { for (const f of events.get(e) ?? []) f(...args); },
    send(raw: string) { this.sent.push(JSON.parse(raw)); },
    frame(frame: unknown) { this.emit('message', Buffer.from(JSON.stringify(frame))); } };
}
function fixture(t: { after(fn: () => void): void }, enabled = true, now = Date.now) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-cubby-'));
  let cubbies: Cubbies | undefined;
  const nodes = new Nodes(dir, () => cubbies?.refresh());
  cubbies = new Cubbies(dir, enabled, nodes, owner => ({ alice: 'Alice', bob: 'Bob' })[owner as 'alice'], id => ['floor', 'other'].includes(id), () => {}, now);
  t.after(() => { nodes.close(); rmSync(dir, { recursive: true, force: true }); });
  const setup = (owner = 'alice', slot = 0, floor = 'floor') => legacyCubby(cubbies!, floor, owner, slot, 'Nova', {skin: 1, hair: 2, style: 3});
  const connect = (token: string, floor = 'floor', computerId = 'computer-alice') => {
    const ws = socket(); nodes.attach(ws as any, token);
    ws.frame({ t: 'hello', name: 'Private computer', host: 'secret-host', providers: ['claude'] });
    ws.frame({ t: 'cubby.hello', floorId: floor, computerId, computerName: 'Alice laptop' });
    return ws;
  };
  return { cubbies, nodes, dir, setup, connect };
}
const roster = () => ({ t: 'cubby.snapshot', floorId: 'floor', observedAt: Date.now(), agents: [{id:'builder',tool:'Claude',role:'builder',task:'Private marketing draft',branch:'private-branch',status:'working',progress:'Private progress'}], plan:['Private plan'],needsYou:['Private decision'] });

test('old device enrollment requests fail without reaching the connector', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token), notices: string[] = [];
  const ctx = { warn: (_c: unknown, text: string) => notices.push(text) } as any;
  cubbiesHandlers['cubbies.addDevice'](ctx, {} as any, {} as any);
  cubbiesHandlers['cubbies.device'](ctx, {} as any, {} as any);
  assert.deepEqual(ws.sent.map(m => m.t), ['cubby.ready']);
  assert.ok(notices.every(text => /enrollment removed.*agent-office link/.test(text)));
});

test('a congested satellite refuses signed frames and chat can retry after it drains', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token);
  const node = f.cubbies.records.rows.get(invite.id)!.nodeId;
  ws.bufferedAmount = 4 * 1024 * 1024 + 1;
  let signed = false;
  assert.equal(f.nodes.sendSigned(node, () => { signed = true; return {}; }), false);
  assert.equal(signed, false, 'backpressure is checked before signing/serializing');
  const notices: string[] = [];
  const ctx = { cubbies: f.cubbies, floorOf: () => ({ id: 'floor' }), warn: (_: unknown, text: string) => notices.push(text) } as any;
  const client = { accountId: 'alice' } as any;
  cubbiesHandlers['cubbies.chat'](ctx, client, { t: 'cubbies.chat', id: invite.id, ...message('blocked') });
  assert.equal(notices.length, 1);
  assert.equal(ws.sent.length, 1, 'nothing is queued');
  ws.bufferedAmount = 0;
  f.cubbies.chat('floor', 'alice', invite.id, message('explicit retry'));
  assert.equal(ws.sent.at(-1).text, 'explicit retry');
});

test('a dropped ready frame does not admit the cubby; a later hello can retry', t => {
  const f = fixture(t), invite = f.setup(), ws = socket();
  f.nodes.attach(ws as any, invite.token);
  ws.frame({ t: 'hello', host: 'computer', providers: [] });
  const hello = { t: 'cubby.hello', floorId: 'floor', computerId: 'computer-alice' };
  ws.bufferedAmount = 4 * 1024 * 1024 + 1;
  assert.doesNotThrow(() => ws.frame(hello));
  assert.equal(ws.sent.length, 0);
  assert.equal(f.cubbies.state('floor', 'alice').cubbies[0].lamp, 'asleep');
  ws.bufferedAmount = 0;
  ws.frame(hello);
  assert.equal(ws.sent[0].t, 'cubby.ready');
  assert.equal(f.cubbies.state('floor', 'alice').cubbies[0].lamp, 'online');
});

test('cubbies are inert unless explicitly enabled, with no retired harness state', t => {
  const f = fixture(t, false);
  assert.deepEqual(f.cubbies.state('floor', 'alice'), {enabled:false,cubbies:[],setupAllowed:false});
  assert.equal(existsSync(path.join(f.dir,'cubbies.json')), false);
  for (const name of ['harness.json','harness-history','reviews.json']) assert.equal(existsSync(path.join(f.dir,name)), false);
});

test('only the owner receives interiors; public and other-admin-shaped requests reveal no contents', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token);
  ws.frame(roster());
  const mine = f.cubbies.state('floor','alice').cubbies[0];
  assert.equal(mine.interior!.agents[0].task,'Private marketing draft');
  assert.equal(mine.lamp,'working'); assert.equal(mine.working,1);
  for (const owner of ['bob',undefined]) {
    const other = f.cubbies.state('floor',owner).cubbies[0];
    assert.deepEqual(Object.keys(other).sort(), ['id','slot','ownerName','ownerColor','mine','lamp','working'].sort());
    assert.equal(other.mine,false);
    assert.doesNotMatch(JSON.stringify(other), /Private|branch|decision|computer|Nova/);
  }
  assert.deepEqual(f.cubbies.state('other','alice').cubbies,[]);
  assert.equal(f.cubbies.state('missing','alice').enabled,false);
  assert.throws(() => f.cubbies.chat('floor','bob',invite.id,message('do work')), /owner/);
  assert.throws(() => f.cubbies.chat('other','alice',invite.id,message('do work')), /owner/);
});

test('only signed owner text is relayed; response correlation and no on-disk conversations', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token);
  const ready = ws.sent[0]; assert.equal(ready.t,'cubby.ready'); assert.equal(verifyRelay(cubbyKey(invite.token),ready),true);
  const sent = message('  Review the proposed screen\n字  ');
  f.cubbies.chat('floor','alice',invite.id,sent);
  const chat = ws.sent[1];
  for (const field of ['text', 'requestId', 'at', 'ownerSig'] as const) assert.equal(chat[field], sent[field]);
  assert.equal(chat.t,'cubby.chat'); assert.equal(chat.ownerId,'alice'); assert.equal(chat.floorId,'floor');
  assert.equal(verifyRelay(cubbyKey(invite.token),chat),true);
  assert.equal(verifyRelay(cubbyKey(invite.token),{...chat,text:'tampered'}),false);
  assert.throws(() => f.cubbies.chat('floor','alice',invite.id,message('second')), /still replying/);
  ws.frame({t:'cubby.reply',floorId:'floor',requestId:'forged',text:'not accepted'});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.chat.length,1);
  ws.frame({t:'cubby.reply',floorId:'floor',requestId:chat.requestId,text:'Here is the review'});
  const history = f.cubbies.state('floor','alice').cubbies[0].interior!.chat;
  assert.deepEqual(history.map(x => x.role),['user','assistant']);
  assert.doesNotMatch(readFileSync(path.join(f.dir,'cubbies.json'),'utf8'),/proposed screen|Here is the review/);
});

test('disconnect, replacement socket and revoke invalidate chat admission and stale sockets', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token);
  ws.frame(roster()); ws.close();
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].lamp,'asleep');
  assert.throws(() => f.cubbies.chat('floor','alice',invite.id,message('offline')), /asleep/);
  const next = socket(); f.nodes.attach(next as any,invite.token); next.frame({t:'hello',host:'same',providers:[]});
  assert.throws(() => f.cubbies.chat('floor','alice',invite.id,message('before opt in')), /asleep/);
  next.frame({t:'cubby.hello',floorId:'floor',computerId:'computer-alice',computerName:'Alice laptop'});
  ws.frame({...roster(),agents:[]});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.agents.length,1);
  f.nodes.revoke(f.cubbies.records.rows.get(invite.id)!.nodeId);
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].lamp,'asleep');
});

test('a node cannot claim another cubby, floor or computer identity; duplicate tuple rejected', t => {
  const f = fixture(t), alice = f.setup(), bob = f.setup('bob',1), a = f.connect(alice.token), b = f.connect(bob.token,'floor','computer-bob');
  a.frame({t:'cubby.hello',floorId:'other',computerId:'computer-bob',computerName:'forged'});
  b.frame({...roster(),floorId:'other'});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.computerName,'Alice laptop');
  assert.equal(f.cubbies.state('floor','bob').cubbies[1].interior!.agents.length,0);
  const duplicate = f.setup('alice',2), duplicateWs = f.connect(duplicate.token);
  assert.deepEqual(duplicateWs.sent,[]);
  assert.equal(f.cubbies.state('floor','alice').cubbies[2].lamp,'asleep');
});

test('invalid or stale snapshots and direct-session details cannot leak into accepted presence', t => {
  const f = fixture(t), invite = f.setup(), ws = f.connect(invite.token);
  ws.frame({...roster(),observedAt:0});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.agents.length,0);
  ws.frame({...roster(),agents:[{...roster().agents[0],role:'direct'}]});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.agents[0].progress,undefined);
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.agents[0].task,'Claude session');
  ws.frame({...roster(),agents:Array(129).fill(roster().agents[0])});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.agents.length,1);
});



test('an online computer with stale observations does not keep advertising old work as live', t => {
  let now = Date.now();
  const f = fixture(t, true, () => now), invite = f.setup(), ws = f.connect(invite.token);
  ws.frame(roster());
  assert.equal(f.cubbies.state('floor', 'alice').cubbies[0].working, 1);
  now += 70_000;
  const stale = f.cubbies.state('floor', 'alice').cubbies[0];
  assert.equal(stale.lamp, 'online'); assert.equal(stale.working, 0);
  assert.equal(stale.interior!.agents[0].status, 'unknown');
  assert.match(stale.interior!.error!, /not refreshed/);
});


test('cubby computers stay owner-only on the Satellite wall, including after reload', t => {
  const f = fixture(t), invite = f.setup(); f.connect(invite.token);
  const nodeId = f.cubbies.records.rows.get(invite.id)!.nodeId;
  assert.equal(f.nodes.state({id:'alice',admin:false}).nodes.length,1);
  assert.deepEqual(f.nodes.state({id:'bob',admin:true}).nodes,[]);
  assert.equal(f.nodes.mayManage(nodeId,{id:'bob',admin:true}),false);
  const reload = new Nodes(f.dir,()=>{}); t.after(()=>reload.close());
  assert.deepEqual(reload.state({id:'bob',admin:true}).nodes,[]);
  assert.equal(reload.state({id:'alice'}).nodes.length,1);
});


test('a missing reply expires visibly without replaying work or accepting a late reply', t => {
  let now = Date.now(); const f = fixture(t, true, () => now), invite = f.setup(), ws = f.connect(invite.token);
  f.cubbies.chat('floor', 'alice', invite.id, message('owner message'));
  const request = ws.sent[1]; now += 13 * 60_000; f.cubbies.refresh();
  assert.equal(ws.sent.length, 2, 'expiry sends no new prompt');
  assert.match(f.cubbies.state('floor','alice').cubbies[0].interior!.chat.at(-1)!.text, /did not reply in time/);
  ws.frame({t:'cubby.reply',floorId:'floor',requestId:request.requestId,text:'late answer'});
  assert.equal(f.cubbies.state('floor','alice').cubbies[0].interior!.chat.length,2);
  assert.doesNotThrow(()=>f.cubbies.chat('floor','alice',invite.id,message('explicit new message')));
});
