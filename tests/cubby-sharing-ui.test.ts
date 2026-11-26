// Sharing a cubby (cubbies step 4), client side, without a browser: what the store keeps for a watcher
// and for the owner, the knock's words, being inside a cubby, the task card's limits, the phone's My
// cubby, and the one lead color the cubby, the draft's greeter and the kickoff walk all use. The 3D and
// the windows are checked in a browser by tests/cubby-sharing-ui.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CubbiesState, CubbyAgent, CubbyInfo } from '../src/shared/protocol/cubbies.js';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});

const { Store } = await import('../src/client/state/store.js');
const { cubbies } = await import('../src/client/state/slices/cubbies.js');
const share = await import('../src/client/features/cubbies/share-model.js');
const model = await import('../src/client/features/cubbies/model.js');
const text = await import('../src/client/shared/cubby/text.js');
const chat = await import('../src/client/shared/cubby/chat.js');
const lite = await import('../src/client/lite-cubby.js');

function keep(st: CubbiesState) {
  const s = new Store([cubbies]);
  s.floor = 'f1';
  s.apply({ t: 'cubbies', state: st } as never);
  return s.cubbies;
}
const look = { skin: 1, hair: 2, style: 3 };
const interior = { computerName: 'Mac mini', leadName: 'Nova', look, agents: [], plan: [], needsYou: ['Approve the cart?'], chat: [] };
const state = (cs: CubbyInfo[]): CubbiesState => ({ enabled: true, floorId: 'f1', cubbies: cs, setupAllowed: true });
const alex: CubbyInfo = { id: 'b', slot: 1, ownerName: 'Alex', mine: false, lamp: 'working', working: 2 };

test('a watcher keeps the inside they were let in to; nobody keeps another account’s watchers or knocks', () => {
  const kept = keep(state([
    { id: 'a', slot: 0, ownerName: 'Jordan', mine: true, lamp: 'online', working: 1, interior,
      watchers: [{ accountId: 'acct-alex', name: 'Alex', extra: 'x' } as never, { bad: true } as never], knocking: [{ accountId: 'acct-sam', name: 'Sam' }] },
    { ...alex, watching: true, interior, watchers: [{ accountId: 'leak', name: 'Leak' }], knocking: [{ accountId: 'leak', name: 'Leak' }] },
    { id: 'c', slot: 2, ownerName: 'Sam', mine: false, lamp: 'working', working: 1, interior },
  ]));
  const [mine, watched, other] = kept.cubbies;
  assert.deepEqual(mine.watchers, [{ accountId: 'acct-alex', name: 'Alex' }]);
  assert.deepEqual(mine.knocking, [{ accountId: 'acct-sam', name: 'Sam' }]);
  assert.equal(watched.watching, true);
  assert.ok(watched.interior);
  assert.equal('watchers' in watched, false);
  assert.equal('knocking' in watched, false);
  assert.equal('interior' in other, false, 'no inside without being let in');
  assert.equal('watching' in other, false);
});

test('a watched cubby opens for its watcher, says so on its sign, and the chat is read-only for them', () => {
  const watched = { ...alex, watching: true as const, interior };
  assert.equal(model.faceOf(watched), 'watch');
  assert.equal(model.faceOf({ ...alex, watching: true }), 'other', 'no inside yet: still frosted');
  assert.equal(model.faceOf(alex), 'other');
  assert.equal(model.signText(watched), '👀 Alex · Mac mini');
  assert.equal(chat.chatMode(watched), 'watching');
  assert.equal(chat.chatMode({ ...alex, mine: true, interior }), 'owner');
  assert.equal(chat.chatMode({ ...alex, interior }), null);
  assert.equal(chat.chatMode(undefined), null);
  assert.equal(chat.watchingNote('Alex', 'Nova'), 'Watching: only Alex can talk to Nova');
});

test('the knock’s words: the door, the wait, the owner’s prompt, the answer, and the hint inside', () => {
  assert.equal(share.knockTitle(alex), '🔒 Alex');
  assert.equal(share.knockAside(alex), '2 working');
  assert.equal(share.knockAside({ lamp: 'asleep', working: 3 }), '💤 asleep');
  assert.equal(share.knockAside({ lamp: 'working', working: -4 }), '0 working');
  assert.equal(share.knockWaiting('Alex'), 'Knocked, waiting for Alex…');
  assert.equal(share.knockPrompt('Sam'), 'Sam knocked on your cubby: let them watch and listen?');
  assert.equal(share.answerText('Alex', true), '🚪 Alex let you in');
  assert.equal(share.answerText('Alex', false), '🚪 Alex is busy');
  assert.equal(share.watchingTitle('Alex'), "👀 Watching Alex's cubby");
  assert.equal(share.knockPrompt(''), 'Someone knocked on your cubby: let them watch and listen?');
  assert.equal(share.knockPending(undefined, 5), false);
  assert.equal(share.knockPending(1000, 1000 + share.KNOCK_WAIT_MS - 1), true);
  assert.equal(share.knockPending(1000, 1000 + share.KNOCK_WAIT_MS), false);
});

test('inside a cubby, whichever way it faces, and just outside its door', () => {
  for (const rotY of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const p = { slot: 0, x: -21, z: -6, width: 4.4, depth: 2.5, rotY };
    const at = (lx: number, lz: number) => model.toFloor(p, lx, lz);
    const inside = (lx: number, lz: number) => share.insideCubby(p, at(lx, lz).x, at(lx, lz).z);
    assert.equal(inside(0, 0), true);
    assert.equal(inside(2.1, -1.1), true);
    assert.equal(inside(0, 1.3), true, 'the threshold counts');
    assert.equal(inside(2.3, 0), false);
    assert.equal(inside(0, -1.3), false);
    assert.equal(inside(0, 1.7), false, 'out in the hall');
    const out = share.outsideDoor(p);
    assert.equal(share.insideCubby(p, out.x, out.z), false);
    const want = at(0, p.depth / 2 + 0.9);
    assert.ok(Math.abs(out.x - want.x) < 1e-9 && Math.abs(out.z - want.z) < 1e-9);
  }
});

test('a task card for the floor: a title and a prompt, within the queue’s limits', () => {
  assert.equal(share.TASK_TITLE_MAX, 120);
  assert.equal(share.TASK_PROMPT_MAX, 4000);
  assert.equal(share.TASK_NOTE, "Runs on the office server, in this floor's public Task queue. Your computer's work stays put.");
  assert.equal(share.cleanTask('  ', 'do it'), null);
  assert.equal(share.cleanTask('Title', '  \n '), null);
  assert.deepEqual(share.cleanTask('  Fix   the\ncart ', ' Make it work \n'), { title: 'Fix the cart', prompt: 'Make it work' });
  const long = share.cleanTask('t'.repeat(300), 'p'.repeat(5000))!;
  assert.equal(long.title.length, 120);
  assert.equal(long.prompt.length, 4000);
  assert.equal(share.taskSentText('Invoices export'), '📋 "Invoices export" is on this floor\'s Task queue');
});

test('the phone’s My cubby: yours first, else one you’re watching; helpers as tool · role · task · status', () => {
  const mine: CubbyInfo = { id: 'a', slot: 0, ownerName: 'Jordan', mine: true, lamp: 'online', working: 1, interior };
  const watched: CubbyInfo = { ...alex, watching: true, interior };
  assert.equal(lite.liteCubby([alex, watched, mine]), mine);
  assert.equal(lite.liteCubby([alex, watched]), watched);
  assert.equal(lite.liteCubby([alex, { ...alex, watching: true }]), undefined);
  assert.equal(lite.liteCubbyLabel(mine), '🚪 My cubby');
  assert.equal(lite.liteCubbyLabel(watched), "👀 Alex's cubby");
  assert.equal(lite.liteCubbyLabel({ ...watched, ownerName: 'Alexandrina Fixture' }), "👀 Alexandri…'s cubby");
  assert.equal(lite.liteCubbyLabel({ ...watched, ownerName: ' ' }), '👀 Watching');
  const a = (role: CubbyAgent['role'], extra: Partial<CubbyAgent> = {}): CubbyAgent => ({ id: role, tool: 'codex', role, task: 'Fix checkout', branch: 'fix/checkout', status: 'working', ...extra });
  assert.equal(chat.helperLine(a('builder'), false), 'Codex · Builder · Fix checkout · working');
  assert.equal(chat.helperLine(a('builder', { status: 'needs-you' }), false), 'Codex · Builder · Fix checkout · needs you');
  assert.equal(chat.helperLine(a('builder'), true), 'Codex · Builder · Fix checkout · 💤 asleep');
  // A session opened directly never shows what it was asked.
  assert.equal(chat.helperLine(a('direct', { task: 'PRIVATE' }), false), 'Codex session · 🌿 fix/checkout · busy');
});

test('one lead, one look: the cubby, the draft greeter and the kickoff walk take the color from the same place', async () => {
  assert.equal(model.leadColorIndex, text.leadColorIndex);
  assert.equal(text.leadColorIndex('Nova'), text.leadColorIndex('Nova'));
  assert.notEqual(text.leadColorIndex('Nova') % 8, text.leadColorIndex('Atlas') % 8);
  const { readFileSync } = await import('node:fs');
  const src = (f: string) => readFileSync(new URL(`../src/client/features/${f}`, import.meta.url), 'utf8');
  assert.match(src('cubbies/interior.ts'), /this\.lead\.setUniform\(ownerName, project, personalRole/);
  assert.match(src('cubbies/room.ts'), /info\.ownerColor/);
  assert.match(src('drafts/index.ts'), /scene\.setLead\(name, it\?\.look, cubbyOf\(\)\?\.ownerColor/);
  assert.match(src('drafts/world.ts'), /this\.lead\.setUniform\(owner, project, role, color\)/);
  // The kickoff's walker is the draft scene's own lead, not a character of its own.
  assert.doesNotMatch(src('drafts/kickoff.ts'), /new Person\(/);
});
