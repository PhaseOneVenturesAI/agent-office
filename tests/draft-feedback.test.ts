import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CubbyConnector } from '../src/server/cubbies/local/connector.js';
import { localDesign } from '../src/server/cubbies/local/design.js';
import { memoryStore, pinOf } from '../src/server/cubbies/local/devices.js';
import { cubbyKey, relaySignature, verifyOwnerFeedback } from '../src/server/cubbies/wire.js';
import { cleanDraftBoards } from '../src/server/drafts/boards.js';
import { boardFeedbackBytes, feedbackBytes, FEEDBACK_FULL } from '../src/server/drafts/feedback-budget.js';
import { BOARD_TOO_BIG, publication } from '../src/server/cubbies/publication.js';
import { draftsHandlers } from '../src/server/ws/handlers/drafts.js';
import type { CubbyAgent } from '../src/shared/protocol/cubbies.js';
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
  const agents: CubbyAgent[] = [{ id: 'builder', role: 'builder', tool: 'codex', task: 'Design', branch: 'main', status: 'working' }];
  const owner = testOwnerKey(), other = testOwnerKey(), stranger = testOwnerKey(), sent: any[] = [], turns: string[] = [];
  const config: LocalConfig = { ownerKey: owner.ownerKey, floor: 'floor', project: dir, roots: [dir], branches: new Map(), state: dir,
    computerId: 'computer', provider: 'claude', session: 'session', executable: 'claude', claudeHome: dir, fresh: false };
  const connector = new CubbyConnector(config, 'token', { now: () => now, release() {}, head: async () => undefined,
    devices: memoryStore([pinOf(owner.ownerKey, 'Owner', now), pinOf(other.ownerKey, 'Phone', now)]),
    snapshot: async () => ({ t: 'cubby.snapshot', floorId: 'floor', agents, plan: [], needsYou: [], observedAt: now, draft: localDesign(dir).boards }),
    lead: { busy, send: async text => { turns.push(text); return 'Lead reply'; }, stop: async () => {} } });
  const send = (frame: any) => connector.receive(JSON.stringify({ ...frame, signature: relaySignature(cubbyKey('token'), frame) }));
  const ready = (connectionId = 'connection') => send({ t: 'cubby.ready', ...binding, connectionId });
  const note = (extra: any = {}, signer = owner) => {
    const frame = { t: 'cubby.feedback', ...binding, cardId: 'idea', text: 'Make it clear', requestId: 'note', at: now, ...extra };
    return { ...frame, ownerSig: signer.signFeedback(frame) };
  };
  connector.connected(f => sent.push(f)); ready();
  t.after(async () => { await connector.close(); rmSync(dir, { recursive: true, force: true }); });
  return { connector, dir, agents, owner, other, stranger, sent, turns, send, note, ready, raw, file: path.join(dir, '.agent-office/feedback.json') };
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

// Fill the aggregate budget exactly, spread over all 40 cards, with the maximum note count that
// fits this budget (not 800 notes: their IDs/envelopes alone can exceed the socket cap).
function fullBoard() {
  const card = (i: number) => ({ id: String(i).padStart(64, 'c'), title: 'T'.repeat(120), note: 'N'.repeat(DRAFT_LIMITS.note),
    status: 'approved', ...(i < DRAFT_LIMITS.images ? { image: { hash: i.toString(16).padStart(64, 'a'),
      mime: 'image/webp', width: 4000, height: 4000 } } : {}),
    feedback: Array.from({ length: i === 0 ? DRAFT_LIMITS.feedbackPerCard : i <= 21 ? 2 : 1 }, (_, n) => ({ id: `${i}-${n}`.padStart(128, 'n'), text: `${i}-${n}`.padEnd(12, 'x'), at: now })) });
  const boards = cleanDraftBoards({ ideas: Array.from({ length: DRAFT_LIMITS.ideas }, (_, i) => card(i)),
    screens: Array.from({ length: DRAFT_LIMITS.screens }, (_, i) => card(i + DRAFT_LIMITS.ideas)),
    decisions: Array(16).fill('D'.repeat(300)), plan: Array(16).fill('P'.repeat(300)),
    brand: { name: 'B'.repeat(80), tagline: 'T'.repeat(200), colors: Array(6).fill('#ffffff') } });
  boards.ideas[0].feedback[0].text += 'x'.repeat(DRAFT_LIMITS.feedbackBytes - boardFeedbackBytes(boards));
  assert.equal(boardFeedbackBytes(boards), DRAFT_LIMITS.feedbackBytes);
  return boards;
}

test('feedback budget counts UTF-8 and escaping with room for maximum IDs and timestamps', () => {
  const note = { id: 'n'.repeat(128), text: '界😀\n\t"\\', at: Number.MIN_SAFE_INTEGER };
  assert.equal(feedbackBytes(note), Buffer.byteLength(JSON.stringify(note.text)) - 2 + DRAFT_LIMITS.feedbackNoteOverhead);
  assert.ok(feedbackBytes(note) >= Buffer.byteLength(JSON.stringify(note)) + 1);
});

test('connector refuses a note crossing the aggregate budget without touching feedback, then accepts after local resolution', async t => {
  const f = fixture(t, true); await tick();
  const boards = fullBoard();
  // Leave exactly one small note's room, then fill it via the signed connector path.
  const pending = boards.ideas[0].feedback.pop()!;
  writeFileSync(path.join(f.dir, '.agent-office/draft.json'), JSON.stringify({ ...boards,
    ideas: boards.ideas.map(c => ({ ...c, feedback: [] })), screens: boards.screens.map(c => ({ ...c, feedback: [] })) }));
  writeFileSync(f.file, JSON.stringify(Object.fromEntries([...boards.ideas, ...boards.screens].map(c => [c.id, c.feedback]))));
  f.send(f.note({ cardId: boards.ideas[0].id, requestId: pending.id, text: pending.text })); await tick();
  assert.equal(boardFeedbackBytes(localDesign(f.dir).boards), DRAFT_LIMITS.feedbackBytes);
  const before = readFileSync(f.file), mtime = statSync(f.file).mtimeMs;
  f.send(f.note({ cardId: boards.screens[0].id, requestId: 'over-budget', text: '界😀"\\' })); await tick();
  assert.deepEqual(readFileSync(f.file), before); assert.equal(statSync(f.file).mtimeMs, mtime);
  assert.ok(f.sent.some(x => x.t === 'cubby.reply' && x.requestId === 'over-budget' && x.error && x.text === FEEDBACK_FULL));
  assert.equal(f.turns.length, 0);
  const saved = JSON.parse(before.toString()); saved[boards.screens[0].id] = [];
  writeFileSync(f.file, JSON.stringify(saved));
  f.send(f.note({ cardId: boards.screens[0].id, requestId: 'after-resolution', text: 'Room again' })); await tick();
  assert.equal(JSON.parse(readFileSync(f.file, 'utf8'))[boards.screens[0].id][0].id, 'after-resolution');
});

test('maximum ASCII board metadata and a full feedback budget publish under 64 KiB and kickoff exports every note', async t => {
  const f = boardFixture(t), boards = fullBoard();
  const frame = { t: 'cubby.snapshot' as const, floorId: f.def.id, observedAt: Date.now(), agents: [],
    plan: Array(16).fill('P'.repeat(240)), needsYou: Array(16).fill('N'.repeat(240)), draft: boards };
  const bytes = Buffer.byteLength(JSON.stringify(frame));
  assert.ok(bytes < 60 * 1024, `${bytes} bytes leaves at least 4 KiB of headroom`);
  t.diagnostic(`Full board frame: ${bytes} bytes; ${65536 - bytes} bytes below the cap`);
  assert.equal(publication(frame), frame);
  f.ws.frame(frame);
  const held = f.cubbies.draftBoards(f.setup.id, 'alice')!;
  assert.deepEqual([...held.ideas, ...held.screens].map(c => c.feedback), [...boards.ideas, ...boards.screens].map(c => c.feedback));
  await f.drafts.kickoff(f.def.id, 'Board', 'alice', f.cubbies);
  const exported = readFileSync(path.join(f.dir, 'drafts', f.def.id, 'docs/FEEDBACK.md'), 'utf8');
  for (const card of [...boards.ideas, ...boards.screens]) for (const note of card.feedback) assert.ok(exported.includes(`${note.at}: ${note.text}`), note.id);
});

test('drafts.feedback refuses a full office board early with the same owner chat notice', t => {
  const f = boardFixture(t); f.publish(fullBoard());
  const sent = f.ws.sent.length, warnings: string[] = [];
  const msg = { t: 'drafts.feedback' as const, floorId: f.def.id, cardId: fullBoard().ideas[0].id,
    requestId: 'full', at: Date.now(), text: 'No room', ownerSig: 'a'.repeat(86) };
  draftsHandlers['drafts.feedback']({ drafts: f.drafts, cubbies: f.cubbies, warn: (_: unknown, text: string) => warnings.push(text) } as any,
    { accountId: 'alice' } as any, msg);
  assert.equal(f.ws.sent.length, sent); assert.deepEqual(warnings, [FEEDBACK_FULL]);
  assert.equal(f.cubbies.state(f.def.id, 'alice').cubbies[0].interior?.chat.at(-1)?.text, FEEDBACK_FULL);
});

test('oversized connector snapshots send visible error frames while roster and device presence keep flowing', async t => {
  const f = fixture(t); await tick(); await tick();
  const rows = Array.from({ length: DRAFT_LIMITS.feedbackPerCard }, (_, i) => ({ id: `old-${i}`, text: '界'.repeat(1000), at: now }));
  writeFileSync(f.file, JSON.stringify({ idea: rows, screen: rows }));
  const before = readFileSync(f.file), devices = f.sent.filter(x => x.t === 'cubby.devices').length;
  for (const status of ['idle', 'working'] as const) {
    f.agents[0].status = status;
    await (f.connector as any).snapshot();
    const frame = f.sent.filter(x => x.t === 'cubby.snapshot').at(-1);
    assert.equal(frame.error, BOARD_TOO_BIG); assert.equal(frame.draft, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 1024); assert.equal(frame.agents[0].status, status);
  }
  assert.equal(f.sent.filter(x => x.t === 'cubby.devices').length, devices + 2);
  assert.deepEqual(readFileSync(f.file), before);
  rmSync(f.file); await (f.connector as any).snapshot();
  assert.ok(f.sent.filter(x => x.t === 'cubby.snapshot').at(-1).draft);
});

test('overflow frame keeps the last full office board and images while updating owner-visible error and roster', t => {
  const f = boardFixture(t); f.upload();
  const before = f.cubbies.draftBoards(f.setup.id, 'alice');
  for (const status of ['working', 'idle'] as const) {
    f.ws.frame(publication({ t: 'cubby.snapshot', floorId: f.def.id, observedAt: Date.now(), plan: [], needsYou: [],
      agents: [{ id: 'builder', role: 'builder', tool: 'codex', task: 'Design', branch: 'main', status }],
      draft: { ...f.boards, decisions: ['x'.repeat(65536)] } }));
    const cubby = f.cubbies.state(f.def.id, 'alice').cubbies[0];
    assert.equal(cubby.interior?.error, BOARD_TOO_BIG); assert.equal(cubby.interior?.agents[0].status, status);
    assert.deepEqual(f.cubbies.draftBoards(f.setup.id, 'alice'), before);
    assert.ok(f.cubbies.draftImage(f.def.id, 'alice', f.image.meta.hash));
  }
});
