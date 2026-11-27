import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LeadTalk } from '../src/server/link/talk.js';
import { markerFile } from '../src/server/link/inbox.js';
import { fixture, frame, record, session, Clock, flush } from './support/link-talk.js';

test('busy inbox polls every two seconds and does not write a marker until idle', async t => {
  const f = fixture(t), clock = new Clock(), frames: any[] = [];
  let busy = true, deliveries = 0;
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', clock, live: () => record(busy ? 'busy' : 'idle'), inbox: async () => { deliveries++; } });
  t.after(() => talk.close()); const message = frame(); talk.receive(message);
  assert.equal(deliveries, 0); assert.equal(existsSync(markerFile(f.stateDirectory, session)), false);
  assert.equal(frames[0].state, 'queued');
  await clock.advance(1999); assert.equal(deliveries, 0);
  busy = false; await clock.advance(1); assert.equal(deliveries, 1);
  assert.equal(readFileSync(markerFile(f.stateDirectory, session), 'utf8'), message.id);
  assert.equal(frames.at(-1).state, 'delivered');
});

test('ten minutes busy fails without an inbox delivery', async t => {
  const f = fixture(t), clock = new Clock(), frames: any[] = [];
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', clock, live: () => record('busy'), inbox: async () => assert.fail('must not deliver') });
  t.after(() => talk.close()); talk.receive(frame()); await clock.advance(10 * 60_000);
  assert.equal(frames.at(-1).error, 'The lead stayed busy; try again');
});

test('one active plus five waiting per lead; duplicate and malformed frames do not deliver', async t => {
  const f = fixture(t), frames: any[] = [], delivered: string[] = [];
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', live: () => record(), inbox: async (_h, _r, f) => { delivered.push(f.id); } });
  t.after(() => talk.close()); const messages = Array.from({ length: 7 }, () => frame());
  messages.forEach(m => talk.receive(m)); talk.receive(messages[0]); talk.receive({ ...frame(), t: 'other' }); await flush();
  assert.deepEqual(delivered, [messages[0].id]);
  assert.equal(frames.filter(f => f.state === 'queued').length, 5);
  assert.equal(frames.find(f => f.id === messages[6].id).error, 'Too many waiting messages');
  talk.activity({ schema: 1, event: 'Stop', sessionId: session, turn: messages[0].id, reply: 'first' }); await flush();
  assert.deepEqual(delivered, [messages[0].id, messages[1].id]);
});

test('twenty pending globally includes queued turns and headless work', async t => {
  const f = fixture(t), frames: any[] = [], clock = new Clock();
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', clock,
    resolve: m => ({ key: 'project' in m.target ? m.target.project : 'cofounder', sessionId: session, project: f.project }),
    live: () => undefined, headless: async (_c, _t, _f, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve('cancelled'))) });
  t.after(() => talk.close());
  for (let i = 0; i < 21; i++) talk.receive(frame(`project-${i}`));
  assert.equal(frames.filter(f => f.state === 'delivered').length, 20);
  assert.equal(frames.at(-1).error, 'Too many waiting messages');
});

test('working is throttled; reply deadline fails after twenty minutes and only removes its own marker', async t => {
  const f = fixture(t), clock = new Clock(), frames: any[] = [];
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', clock, live: () => record(), inbox: async () => {} });
  t.after(() => talk.close()); const message = frame(); talk.receive(message); await flush();
  const activity = { schema: 1 as const, event: 'PreToolUse', sessionId: session };
  talk.activity(activity); talk.activity(activity); await clock.advance(4999); talk.activity(activity);
  assert.equal(frames.filter(f => f.state === 'working').length, 1);
  await clock.advance(1); talk.activity(activity); assert.equal(frames.filter(f => f.state === 'working').length, 2);
  await clock.advance(20 * 60_000 - 5001); assert.notEqual(frames.at(-1).state, 'failed');
  await clock.advance(1); assert.equal(frames.at(-1).error, 'No reply yet; check the lead in the Claude app');
  assert.equal(existsSync(markerFile(f.stateDirectory, session)), false);
  talk.receive(frame()); await flush();
  writeFileSync(markerFile(f.stateDirectory, session), 'replacement');
  await clock.advance(20 * 60_000); assert.equal(readFileSync(markerFile(f.stateDirectory, session), 'utf8'), 'replacement');
});

test('queued work rechecks filtering before delivery; shutdown cancels busy waits', async t => {
  const f = fixture(t), clock = new Clock(), frames: any[] = [];
  let busy = true;
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', clock, live: () => record(busy ? 'busy' : 'idle'), inbox: async () => assert.fail('filtered project') });
  talk.receive(frame()); f.registry({ One: { path: f.project, leadSessionId: session, office: 'hidden' } }); busy = false;
  await clock.advance(2000); assert.equal(frames.at(-1).state, 'failed'); await talk.close();
  f.registry({ One: { path: f.project, leadSessionId: session } });
  const second = new LeadTalk(f.config, () => {}, { platform: 'darwin', clock, live: () => record('busy') });
  second.receive(frame()); await second.close(); assert.equal(clock.timers.size, 0);
});

test('fast Stop waits for delivered before forwarding the reply', async t => {
  const f = fixture(t), frames: any[] = []; let complete!: () => void;
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', live: () => record(), inbox: async () => new Promise<void>(r => { complete = r; }) });
  t.after(() => talk.close()); const message = frame(); talk.receive(message);
  talk.activity({ schema: 1, event: 'Stop', sessionId: session, turn: message.id, reply: 'fast' });
  assert.equal(frames.length, 0); complete(); await flush();
  assert.deepEqual(frames.map(f => f.state ?? f.t), ['delivered', 'lead.reply']);
});

test('app-only and native targets for one live session share the same queue', async t => {
  const f = fixture(t), delivered: string[] = [], frames: any[] = [];
  f.registry({ One: { path: f.project, leadSessionId: session, departmentLeads: [{ department: 'Design', title: 'Design lead', appSession: 'same-app' }] } });
  const talk = new LeadTalk(f.config, e => frames.push(e), { platform: 'darwin', live: () => record(), inbox: async (_h, _r, message) => { delivered.push(message.id); } });
  t.after(() => talk.close()); const first = frame(), second = { ...frame(), target: { project: 'One', department: 0 } };
  talk.receive(first); talk.receive(second); await flush();
  assert.deepEqual(delivered, [first.id]); assert.equal(frames.find(f => f.id === second.id).state, 'queued');
  assert.equal(readFileSync(markerFile(f.stateDirectory, session), 'utf8'), first.id);
  talk.activity({ schema: 1, event: 'Stop', sessionId: session, turn: first.id, reply: 'done' }); await flush();
  assert.deepEqual(delivered, [first.id, second.id]);
});
