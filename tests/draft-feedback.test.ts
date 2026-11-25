import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { localDesign } from '../src/server/cubbies/local/design.js';
import { memoryStore, pinOf } from '../src/server/cubbies/local/devices.js';
import { cubbyKey, relaySignature, verifyOwnerFeedback } from '../src/server/cubbies/wire.js';
import { DRAFT_LIMITS } from '../src/shared/protocol/drafts.js';
import type { LocalConfig } from '../src/server/cubbies/local/config.js';
import { testOwnerKey } from './support/cubby-keys.js';
import { boardFixture, png } from './support/draft-board.js';
const now = 1_800_000_000_000;
const binding = { cubbyId: 'cubby', floorId: 'floor', ownerId: 'owner', connectionId: 'connection', computerId: 'computer' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t: any, busy = false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'draft-feedback-')); mkdirSync(path.join(dir, '.agent-office/design'), { recursive: true });
  const raw = { ideas: [{ id: 'idea', title: 'A good idea' }], screens: [{ id: 'screen', title: 'Screen', status: 'review', image: 'design/design.txt' }] };
  writeFileSync(path.join(dir, '.agent-office/draft.json'), JSON.stringify(raw)); writeFileSync(path.join(dir, '.agent-office/design/design.txt'), png);
  const owner = testOwnerKey(), other = testOwnerKey(), stranger = testOwnerKey(), sent: any[] = [], turns: string[] = [];
  const config: LocalConfig = { ownerKey: owner.ownerKey, floor: 'floor', project: dir, roots: [dir], branches: new Map(), state: dir,
    computerId: 'computer', provider: 'claude', session: 'session', executable: 'claude', claudeHome: dir, fresh: false };
  const connector = new CubbyConnector(config, 'token', { now: () => now, release() {}, head: async () => undefined,
    devices: memoryStore([pinOf(owner.ownerKey, 'Owner', now), pinOf(other.ownerKey, 'Phone', now)]),
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents: [], plan: [], needsYou: [], observedAt: now, draft: localDesign(dir).boards }),
    lead: { busy, send: async text => { turns.push(text); return 'Lead reply'; }, stop: async () => {} } });
  const send = (frame: any) => connector.receive(JSON.stringify({ ...frame, signature: relaySignature(cubbyKey('token'), frame) }));
  const ready = (connectionId = 'connection') => send({ t: 'cubby.ready', ...binding, connectionId });
  const note = (extra: any = {}, signer = owner) => {
    const frame = { t: 'cubby.feedback', ...binding, cardId: 'idea', text: 'Make it clear', requestId: 'note', at: now, ...extra };
    return { ...frame, ownerSig: signer.signFeedback(frame) };
  };
  connector.connected(f => sent.push(f)); ready();
  t.after(async () => { await connector.close(); rmSync(dir, { recursive: true, force: true }); });
  return { connector, dir, owner, other, stranger, sent, turns, send, note, ready, raw, file: path.join(dir, '.agent-office/feedback.json') };
}

test('trusted second device feedback is saved atomically at 0600, published and sent to an idle lead', async t => {
  const f = fixture(t); await tick();
  const note = f.note({}, f.other); assert.equal(verifyOwnerFeedback(f.other.ownerKey, note), true);
  f.send(note); await tick();
  assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')).idea, [{ id: 'note', text: 'Make it clear', at: now }]);
  assert.equal(statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(f.turns, ['Feedback on A good idea: Make it clear']);
  assert.equal(localDesign(f.dir).boards.ideas[0].feedback[0].text, 'Make it clear');
  assert.ok(f.sent.some(x => x.t === 'cubby.snapshot' && x.draft.ideas[0].feedback.length === 1));
  assert.ok(f.sent.some(x => x.t === 'cubby.reply' && /Feedback saved/.test(x.text)));
});

test('untrusted, forged, stale, future, unknown-card and replay notes change nothing', async t => {
  const f = fixture(t); await tick();
  const bad = [f.note({}, f.stranger), { ...f.note(), text: 'forged' }, f.note({ at: now - 60_001 }),
    f.note({ at: now + 60_001 }), f.note({ cardId: 'missing' }), f.note({ cardId: '../bad' }), f.note({ text: 'x'.repeat(DRAFT_LIMITS.feedbackText + 1) })];
  for (const frame of bad) f.send(frame);
  assert.equal(existsSync(f.file), false); assert.deepEqual(f.turns, []);
  assert.ok(f.sent.some(x => x.t === 'cubby.reply' && /not signed/.test(x.text)));
  f.send(f.note()); await tick(); const saved = readFileSync(f.file);
  f.send(f.note()); await tick(); assert.deepEqual(readFileSync(f.file), saved); assert.equal(f.turns.length, 1);
  f.connector.connected(x => f.sent.push(x)); f.ready('next');
  f.send(f.note({ connectionId: 'next' })); await tick(); assert.deepEqual(readFileSync(f.file), saved); assert.equal(f.turns.length, 1);
});

test('busy lead saves bounded feedback without chat dispatch; card removals and file aliases fail closed', async t => {
  const f = fixture(t, true); await tick();
  for (let i = 0; i < 23; i++) f.send(f.note({ requestId: 'note-' + i }));
  await tick(); assert.equal(f.turns.length, 0);
  const rows = JSON.parse(readFileSync(f.file, 'utf8')).idea;
  assert.equal(rows.length, DRAFT_LIMITS.feedbackPerCard); assert.equal(rows[0].id, 'note-3');
  assert.ok(f.sent.some(x => x.t === 'cubby.reply' && /lead is busy/.test(x.text)));
  const before = readFileSync(f.file); f.raw.ideas = []; writeFileSync(path.join(f.dir, '.agent-office/draft.json'), JSON.stringify(f.raw));
  f.send(f.note({ requestId: 'removed' })); assert.deepEqual(readFileSync(f.file), before);
  rmSync(f.file); const target = path.join(f.dir, 'private.json'); writeFileSync(target, '{}'); symlinkSync(target, f.file);
  f.send(f.note({ cardId: 'screen', requestId: 'alias' })); assert.equal(readFileSync(target, 'utf8'), '{}');
});

test('connector sends cleaned referenced images once per connection, resends on reconnect, omits removed cards', async t => {
  const f = fixture(t); await tick(); await tick();
  const images = () => f.sent.filter(x => x.t === 'cubby.design-image');
  assert.equal(images().length, 1); assert.deepEqual(Buffer.from(images()[0].data, 'base64'), png);
  f.send(f.note()); await tick(); assert.equal(images().length, 1);
  f.connector.connected(x => f.sent.push(x)); f.ready('second'); await tick(); await tick(); assert.equal(images().length, 2);
  const screens = f.raw.screens;
  f.raw.screens = []; writeFileSync(path.join(f.dir, '.agent-office/draft.json'), JSON.stringify(f.raw));
  await (f.connector as any).snapshot(); assert.equal(images().length, 2);
  f.raw.screens = screens; writeFileSync(path.join(f.dir, '.agent-office/draft.json'), JSON.stringify(f.raw));
  await (f.connector as any).snapshot(); assert.equal(images().length, 3, 'same bytes re-sent on the same connection after removal');
  await (f.connector as any).snapshot(); assert.equal(images().length, 3);
});

test('office relays feedback only for owner, current draft card and online computer and shows notices', t => {
  const f = boardFixture(t), owner = testOwnerKey();
  const ready = f.ws.sent.find(x => x.t === 'cubby.ready');
  const message = { ...ready, cardId: 'idea', text: 'Review this', requestId: 'feedback', at: Date.now() };
  const note = { ...message, ownerSig: owner.signFeedback(message) };
  assert.throws(() => f.cubbies.feedback(f.def.id, 'bob', note));
  assert.throws(() => f.cubbies.feedback(f.def.id, 'alice', { ...note, cardId: 'missing' }));
  f.cubbies.feedback(f.def.id, 'alice', note);
  assert.equal(f.ws.sent.at(-1).t, 'cubby.feedback'); assert.equal(f.ws.sent.at(-1).ownerSig, note.ownerSig);
  f.ws.frame({ t: 'cubby.reply', floorId: f.def.id, requestId: note.requestId, text: 'Feedback saved', error: true });
  assert.equal(f.cubbies.state(f.def.id, 'alice').cubbies[0].interior?.chat.at(-1)?.role, 'notice');
  assert.equal(f.cubbies.state(f.def.id, 'bob').cubbies.length, 0);
  f.ws.close(); assert.throws(() => f.cubbies.feedback(f.def.id, 'alice', { ...note, requestId: 'later' }), /asleep/);
});
