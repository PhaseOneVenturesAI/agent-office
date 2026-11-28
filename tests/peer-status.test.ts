import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_PRESETS, STATUS_TEXT_MAX, sameStatus, sanitizeStatus, statusLabel } from '../src/shared/peer-status.js';
import { statusHandlers } from '../src/server/ws/handlers/peer-status.js';
import type { PeerInfo } from '../src/shared/protocol.js';

test('a status is an emoji and a few words, either one alone, or nothing', () => {
  assert.deepEqual(sanitizeStatus({ emoji: '☕', text: 'BRB' }), { emoji: '☕', text: 'BRB' });
  assert.deepEqual(sanitizeStatus({ emoji: '', text: 'BRB' }), { emoji: '', text: 'BRB' });
  assert.deepEqual(sanitizeStatus({ emoji: '🌴', text: '   ' }), { emoji: '🌴', text: '' });
  assert.equal(sanitizeStatus({ emoji: '', text: '' }), undefined);
  assert.equal(sanitizeStatus(null), undefined);
  assert.equal(sanitizeStatus('BRB'), undefined);
  assert.equal(sanitizeStatus({ emoji: 5, text: ['x'] }), undefined);
});

test('the words are tidied and cut to the limit; the emoji is one emoji, never letters', () => {
  assert.equal(sanitizeStatus({ emoji: '', text: '  at the\n\tdentist  ' })!.text, 'at the dentist');
  assert.equal([...sanitizeStatus({ emoji: '', text: 'x'.repeat(500) })!.text].length, STATUS_TEXT_MAX);
  // A skin tone or a family is one emoji as it's drawn, and kept whole.
  assert.equal(sanitizeStatus({ emoji: '👋🏽🎉', text: '' })!.emoji, '👋🏽');
  assert.equal(sanitizeStatus({ emoji: '👨‍👩‍👧', text: '' })!.emoji, '👨‍👩‍👧');
  assert.equal(sanitizeStatus({ emoji: 'LOL', text: 'hi' })!.emoji, '');
  assert.equal(sanitizeStatus({ emoji: '!', text: 'hi' })!.emoji, '');
});

test('every quick pick is a valid status, and reads as its emoji then its words', () => {
  for (const p of STATUS_PRESETS) assert.deepEqual(sanitizeStatus(p), p);
  assert.equal(statusLabel({ emoji: '☕', text: 'BRB' }), '☕ BRB');
  assert.equal(statusLabel({ emoji: '', text: 'BRB' }), 'BRB');
  assert.equal(statusLabel({ emoji: '🌴', text: '' }), '🌴');
  assert.ok(sameStatus(undefined, undefined));
  assert.ok(!sameStatus({ emoji: '☕', text: 'BRB' }, undefined));
});

function fixture() {
  const sent: unknown[] = [];
  const client = { id: 'peer-a', peer: { id: 'peer-a', name: 'Ada' } as PeerInfo };
  const ctx = { broadcast: (msg: unknown) => sent.push(msg) };
  const invoke = (msg: unknown) => (statusHandlers.status as any)(ctx, client, msg);
  return { client, sent, invoke };
}

test('putting a status up keeps it on the peer for whoever arrives later, and tells everyone', () => {
  const { client, sent, invoke } = fixture();
  invoke({ t: 'status', status: { emoji: '☕', text: 'BRB' } });
  assert.deepEqual(client.peer.status, { emoji: '☕', text: 'BRB' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { t: 'peer.update', peer: client.peer });
  // The same again changes nothing, so nobody hears it twice.
  invoke({ t: 'status', status: { emoji: '☕', text: 'BRB' } });
  assert.equal(sent.length, 1);
});

test('null (or nothing valid) takes it down', () => {
  const { client, sent, invoke } = fixture();
  invoke({ t: 'status', status: { emoji: '📅', text: 'In a meeting' } });
  invoke({ t: 'status', status: null });
  assert.equal(client.peer.status, undefined);
  assert.equal(sent.length, 2);
  invoke({ t: 'status', status: { emoji: 'nope', text: '' } });
  assert.equal(sent.length, 2, 'already down');
});
