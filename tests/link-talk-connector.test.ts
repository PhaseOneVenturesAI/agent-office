import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MacConnector } from '../src/server/hq/local/connector.js';
import { LeadTalk } from '../src/server/link/talk.js';
import { macSignature } from '../src/server/hq/wire.js';
import { cubbyKey } from '../src/server/cubbies/wire.js';
import { fixture, frame, record, flush } from './support/link-talk.js';

test('lead.send reaches talk only after authenticated hq.ready and full-length text fits', async t => {
  const f = fixture(t), token = randomBytes(32).toString('hex'), sent: any[] = [], delivered: any[] = [];
  const talk = new LeadTalk(f.config, e => connector.sendLead(e), { platform: 'darwin', live: () => record(), inbox: async (_h, _r, frame) => { delivered.push(frame); } });
  const connector = new MacConnector(f.config, token, async () => ({ t: 'hq.snapshot', computerId: f.config.computerId, observedAt: Date.now(), projects: [] }), frame => talk.receive(frame));
  t.after(async () => { await talk.close(); await connector.close(); });
  const message = { ...frame(), text: '界'.repeat(4000) }, wire = JSON.stringify(message);
  connector.connected(f => sent.push(f)); connector.receive(wire); assert.equal(delivered.length, 0);
  const ready = { t: 'hq.ready' as const, computerId: f.config.computerId, owner: 'alice', floor: 'hq', connection: 'connection-1' };
  connector.receive(JSON.stringify({ ...ready, signature: 'invalid' })); connector.receive(wire); assert.equal(delivered.length, 0);
  connector.receive(JSON.stringify({ ...ready, signature: macSignature(cubbyKey(token), ready) }));
  connector.receive(JSON.stringify({ ...message, t: 'arbitrary', command: 'bad' })); connector.receive(wire); await flush();
  assert.equal(delivered.length, 1); assert.equal(delivered[0].text.length, 4000);
  assert.ok(sent.some(f => f.id === message.id && f.state === 'delivered'));
  connector.disconnected(); connector.receive(JSON.stringify(frame())); assert.equal(delivered.length, 1);
});
