import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTES, EMOTE_BURST, EMOTE_EVERY, EmoteBucket, emoteDone, isEmote } from '../src/shared/emotes.js';
import { presenceHandlers } from '../src/server/ws/handlers/presence.js';
import type { PeerInfo } from '../src/shared/protocol.js';

test('the wheel has the eleven emotes, each with an emoji; the two dances loop', () => {
  assert.deepEqual(
    EMOTES.map((e) => e.id),
    ['wave', 'thumbs', 'down', 'clap', 'point', 'shrug', 'laugh', 'facepalm', 'sixseven', 'dance', 'spin'],
  );
  assert.deepEqual(
    EMOTES.filter((e) => e.loop).map((e) => e.id),
    ['dance', 'spin'],
  );
  assert.equal(new Set(EMOTES.map((e) => e.emoji)).size, EMOTES.length, 'every emote has its own emoji');
  for (const e of EMOTES) assert.ok(e.emoji && e.label && e.seconds > 0);
});

test('only known emotes get through', () => {
  assert.ok(isEmote('wave'));
  assert.ok(isEmote('sixseven'));
  assert.ok(!isEmote('moonwalk'));
  assert.ok(!isEmote(1));
  assert.ok(!isEmote(undefined));
});

test('a one-shot is done after its seconds; a loop is not', () => {
  const wave = EMOTES.find((e) => e.id === 'wave')!;
  const dance = EMOTES.find((e) => e.id === 'dance')!;
  assert.ok(!emoteDone(wave, 1000, 1000 + wave.seconds * 1000 - 1));
  assert.ok(emoteDone(wave, 1000, 1000 + wave.seconds * 1000 + 1));
  assert.ok(!emoteDone(dance, 1000, 1000 + 60_000));
});

test('a burst of emotes, then one every EMOTE_EVERY ms', () => {
  const b = new EmoteBucket();
  const t0 = 1_000_000;
  for (let i = 0; i < EMOTE_BURST; i++) assert.ok(b.take(t0), `emote ${i + 1} of the burst`);
  assert.ok(!b.take(t0), 'one too many');
  assert.ok(!b.take(t0 + EMOTE_EVERY * 0.9), 'still too soon');
  assert.ok(b.take(t0 + EMOTE_EVERY), 'one more after a wait');
  assert.ok(!b.take(t0 + EMOTE_EVERY + 10));
});

test('mashing the keys never gets more through than the burst plus the refill', () => {
  const b = new EmoteBucket();
  let passed = 0;
  // Ten seconds of pressing an emote key every 50 ms.
  for (let t = 0; t <= 10_000; t += 50) if (b.take(1_000_000 + t)) passed++;
  assert.equal(passed, EMOTE_BURST + Math.floor(10_000 / EMOTE_EVERY));
});

test("the server's more lenient bucket lets through everything the page's does, even bunched up on the way", () => {
  const page = new EmoteBucket();
  const server = new EmoteBucket(EMOTE_EVERY * 0.8);
  // Sent as fast as the page allows for ten seconds. The opening burst is held up on the wire and
  // arrives late, all at once; the next one gets there straight away.
  let sent = 0;
  for (let t = 1_000_000; t <= 1_010_000; t += 50) {
    if (!page.take(t)) continue;
    const delay = sent++ < EMOTE_BURST ? 300 : 0;
    assert.ok(server.take(t + delay), `emote ${sent} sent at ${t} arrives at ${t + delay}`);
  }
  assert.ok(sent > EMOTE_BURST + 3);
});

/** A client and the messages its office got, for driving the presence handlers directly. */
function fixture() {
  const sent: { to: string[]; msg: unknown }[] = [];
  const client = {
    id: 'peer-a',
    peer: { id: 'peer-a', name: 'Ada', x: 0, y: 0, z: 0, rotY: 0, moving: false } as PeerInfo,
    emotes: new EmoteBucket(EMOTE_EVERY * 0.8),
  };
  const ctx = {
    clients: new Map([[client.id, client]]),
    toNeighbors: (c: unknown, msg: unknown) => sent.push({ to: [(c as typeof client).id], msg }),
    broadcast: (msg: unknown) => sent.push({ to: ['*'], msg }),
  };
  const invoke = (name: 'emote' | 'move', msg: unknown) => (presenceHandlers[name] as any)(ctx, client, msg);
  return { client, sent, invoke };
}

test('a valid emote is broadcast to the floor and kept on the peer for whoever arrives mid-emote', () => {
  const { client, sent, invoke } = fixture();
  invoke('emote', { t: 'emote', emote: 'sixseven' });
  assert.equal(sent.length, 1);
  const msg = sent[0].msg as { t: string; id: string; emote: string; at: number };
  assert.equal(msg.t, 'peer.emote');
  assert.equal(msg.id, 'peer-a');
  assert.equal(msg.emote, 'sixseven');
  assert.deepEqual(client.peer.emote, { id: 'sixseven', at: msg.at });
});

test('an unknown emote id is dropped: no broadcast, nothing kept', () => {
  const { client, sent, invoke } = fixture();
  invoke('emote', { t: 'emote', emote: 'moonwalk' });
  assert.equal(sent.length, 0);
  assert.equal(client.peer.emote, undefined);
});

test('the server rate-limits emotes after the burst', () => {
  const { sent, invoke } = fixture();
  for (let i = 0; i < EMOTE_BURST; i++) invoke('emote', { t: 'emote', emote: 'wave' });
  assert.equal(sent.length, EMOTE_BURST);
  invoke('emote', { t: 'emote', emote: 'wave' });
  assert.equal(sent.length, EMOTE_BURST, 'one too many, too soon');
});

test('moving cancels the emote on the server, so a late joiner never finds a stale one', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { client, invoke } = fixture();
  invoke('emote', { t: 'emote', emote: 'dance' });
  assert.ok(client.peer.emote);
  // Still standing there: the dance loops, and a one-shot a moment later is still live too.
  t.mock.timers.tick(4000);
  invoke('move', { t: 'move', x: 0, y: 0, z: 0, rotY: 0, moving: false });
  assert.ok(client.peer.emote, 'standing still, the dance is still on');
  // A step clears it, and the next emote (a one-shot) expires on its own once its seconds pass.
  invoke('move', { t: 'move', x: 1, y: 0, z: 0, rotY: 0, moving: true });
  assert.equal(client.peer.emote, undefined, 'moving cancelled the dance');
  invoke('emote', { t: 'emote', emote: 'wave' });
  assert.ok(client.peer.emote);
  t.mock.timers.tick(2.2 * 1000 + 1500);
  assert.equal(client.peer.emote, undefined, 'the wave expired after its seconds');
});
