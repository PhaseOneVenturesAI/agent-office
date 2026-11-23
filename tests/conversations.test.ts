import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerConversations } from '../src/server/workers/conversations.js';
import { conversationHandlers, conversationHooks } from '../src/server/ws/handlers/conversations.js';

function fixture() {
  const worker: any = { info: { id: 'w', provider: 'claude', status: 'idle', sessionId: 'session' } };
  const prompts: string[] = []; let interruptions = 0;
  const service = new WorkerConversations(new Map([['w', worker]]), (_id, text) => { prompts.push(text); }, () => { interruptions++; }, (w, status) => { w.info.status = status; });
  return { service, worker, prompts, interruptions: () => interruptions };
}

test('manual conversation submits to an existing idle worker once and never answers permission prompts', () => {
  const f = fixture();
  assert.equal(f.service.send('w', 'Continue this task', 'Jonathan'), undefined);
  assert.deepEqual(f.prompts, ['Continue this task']);
  assert.equal(f.worker.info.status, 'working');
  assert.equal(typeof f.service.send('w', 'duplicate', 'Jonathan'), 'string');
  f.worker.info.status = 'needs_input';
  assert.equal(typeof f.service.send('w', 'yes', 'Jonathan'), 'string');
  assert.equal(typeof f.service.stop('w', 'Jonathan'), 'string');
  assert.equal(f.interruptions(), 0);
  f.worker.info.status = 'working'; f.service.stop('w', 'Jonathan'); assert.equal(f.interruptions(), 1);
  f.worker.info.provider = 'custom'; f.worker.info.status = 'idle';
  assert.match(f.service.send('w', 'hello', 'Jonathan')!, /unavailable/);
});

test('assistant feed deduplicates, bounds history, drops recognizable credentials and resets with session', () => {
  const f = fixture(), heard: string[] = [];
  const off = f.service.subscribe('w', (m) => heard.push(m.id));
  f.service.assistant('w', { id: '1', text: 'Ready.' }); f.service.assistant('w', { id: '1', text: 'Ready.' });
  f.service.assistant('w', { id: '2', text: 'password=hidden' });
  assert.deepEqual(heard, ['1']);
  for (let i = 0; i < 40; i++) f.service.assistant('w', { id: `msg-${i}`, text: 'A valid answer.' });
  assert.equal(f.service.snapshot('w').length, 30);
  off(); const count = heard.length; f.service.assistant('w', { id: 'after', text: 'After close.' }); assert.equal(heard.length, count);
  f.worker.info.sessionId = 'new'; assert.deepEqual(f.service.snapshot('w'), []);
});

test('private subscription closes on floor exit; no broadcast or raw terminal path exists', () => {
  const f = fixture(), messages: any[] = [], client: any = { accountId: 'account', peer: { name: 'Jonathan' } };
  const floor: any = { workers: { conversations: f.service, get: () => f.worker.info, ownerOf: () => 'account' } };
  const ctx: any = { signins: { officeRevoked: () => false, officeAllowed: () => false }, workerFloor: () => floor, floorOf: () => floor, meOf: () => ({ admin: false }), stillIn: () => true, sendTo: (_c: unknown, m: unknown) => messages.push(m), warn: () => assert.fail('unexpected warning') };
  conversationHandlers['conversation.open'](ctx, client, { t: 'conversation.open', workerId: 'w' });
  f.service.assistant('w', { id: 'a', text: 'Visible answer.' });
  assert.equal(messages.length, 2);
  conversationHooks.leaving!(ctx, client, floor);
  f.service.assistant('w', { id: 'b', text: 'Not delivered after leave.' }); assert.equal(messages.length, 2);
});
