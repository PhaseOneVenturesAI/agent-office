// The cubby hall's client side, without a browser: what the store keeps (never anyone else's inside),
// where each agent goes in a cubby, what the signs say, and the join command. The 3D rooms and the
// windows are checked in a browser by tests/cubby-ui.mjs.
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
const NO_CUBBIES = { enabled: false, cubbies: [], setupAllowed: false };
/** What the store keeps of `st`, taken in as a `cubbies` message on floor f1. */
function cleanCubbies(st: CubbiesState | undefined) {
  const s = new Store([cubbies]);
  s.floor = 'f1';
  s.apply({ t: 'cubbies', state: st } as never);
  return s.cubbies;
}
const { SLICES } = await import('../src/client/state/slices/index.js');
const model = await import('../src/client/features/cubbies/model.js');

const look = { skin: 1, hair: 2, style: 3 };
const agent = (id: string, role: CubbyAgent['role'], extra: Partial<CubbyAgent> = {}): CubbyAgent => ({ id, tool: 'Codex', role, task: `task ${id}`, branch: `b/${id}`, status: 'working', ...extra });
const interior = { computerName: 'MacBook Pro', leadName: 'Nova', look, agents: [], plan: [], needsYou: [], chat: [] };
const state = (cs: CubbyInfo[], floorId = 'f1'): CubbiesState => ({ enabled: true, floorId, cubbies: cs, setupAllowed: true });

test('the slice is registered last, and keeps nobody else’s interior even if one arrives', () => {
  assert.equal(SLICES[SLICES.length - 1], cubbies);
  const leaked = state([
    { id: 'a', slot: 0, ownerName: 'Jonathan', mine: true, lamp: 'online', working: 1, interior },
    { id: 'b', slot: 1, ownerName: 'Alex', mine: false, lamp: 'working', working: 2, interior },
  ]);
  const clean = cleanCubbies(leaked);
  assert.ok(clean.cubbies[0].interior);
  assert.equal(clean.cubbies[1].interior, undefined);
  assert.equal('interior' in clean.cubbies[1], false);
  assert.deepEqual(cleanCubbies(undefined), NO_CUBBIES);
  assert.deepEqual(cleanCubbies({ enabled: false, cubbies: leaked.cubbies, setupAllowed: true }), NO_CUBBIES);
});

test('the store takes cubbies from their message and from each floor, and ignores another floor’s', () => {
  const s = new Store([cubbies]);
  const fired: string[] = [];
  s.on('cubbies', () => fired.push('cubbies'));
  s.floor = 'f1';
  const msg = (st: CubbiesState) => ({ t: 'cubbies', state: st }) as never;
  s.apply(msg(state([{ id: 'a', slot: 2, ownerName: 'Jo', mine: true, lamp: 'asleep', working: 0 }])));
  assert.equal(s.cubbies.enabled, true);
  assert.equal(s.cubbies.cubbies[0].slot, 2);
  s.apply(msg(state([], 'f2')));
  assert.equal(s.cubbies.cubbies.length, 1, 'a late answer for another floor is ignored');
  // A floor without a hall (FloorView without cubbies) turns it all off.
  s.apply({ t: 'floor.enter' } as never);
  assert.deepEqual(s.cubbies, NO_CUBBIES);
  assert.deepEqual(fired, ['cubbies', 'cubbies']);
});

test('agents go where their role goes, two builders at the desk, the rest on overflow bean bags', () => {
  const agents = [agent('l', 'lead'), agent('b1', 'builder'), agent('b2', 'builder'), agent('b3', 'builder'), agent('r', 'reviewer'), agent('f', 'factory'), agent('p', 'paradev'), agent('d', 'direct')];
  const { spots, listed } = model.layoutAgents(agents, 4.3, 4);
  assert.equal(spots.has('l'), false, 'the lead is the room’s own character');
  assert.deepEqual([spots.get('b1')?.kind, spots.get('b2')?.kind, spots.get('b3')?.kind], ['seat', 'seat', 'bag']);
  assert.equal(spots.get('r')?.kind, 'reviewer');
  assert.equal(spots.get('f')?.kind, 'machine');
  assert.equal(spots.get('p')?.kind, 'screen');
  assert.equal(spots.get('d')?.kind, 'stand');
  assert.deepEqual(listed, []);
  // Every spot is inside the room.
  for (const s of spots.values()) assert.ok(Math.abs(s.x) < 2.15 && Math.abs(s.z) < 2, `${s.kind} ${s.x},${s.z}`);
  // Past the overflow bags, agents are still counted and listed (inspectable from the lead's window).
  const many = Array.from({ length: 9 }, (_, i) => agent(`x${i}`, 'builder'));
  const crowd = model.layoutAgents(many, 4.3, 4);
  assert.equal(crowd.spots.size, 5);
  assert.deepEqual(crowd.listed, ['x5', 'x6', 'x7', 'x8']);
});

test('signs say only a name, the lamp and the count for anyone else', () => {
  const other: CubbyInfo = { id: 'b', slot: 1, ownerName: 'Alex', mine: false, lamp: 'working', working: 2 };
  assert.equal(model.signText(other), '🔒 Alex · 2 working');
  assert.equal(model.signText({ ...other, lamp: 'asleep' }), '🔒 Alex · 💤 asleep');
  assert.equal(model.signText(undefined), '✨ Free cubby');
  assert.equal(model.signText({ ...other, mine: true, interior }), 'Alex · MacBook Pro');
  assert.equal(model.faceOf(other), 'other');
});

test('a session local session shows its tool, branch and state, never its task', () => {
  const card = model.agentCard(agent('d', 'direct', { task: 'secret prompt text', progress: 'more' }));
  assert.ok(!JSON.stringify(card).includes('secret'));
  assert.ok(!JSON.stringify(card).includes('more'));
  assert.match(card.body, /b\/d/);
  assert.equal(model.workerStatus('working', true), 'offline');
  assert.equal(model.workerStatus('needs-you', false), 'needs_input');
});

test('the join command carries the token, the floor and a locally chosen project folder, safely quoted', () => {
  const base = { origin: 'https://office.example', token: 'tok_123', floorId: 'plimbo', cloudflare: false };
  assert.equal(model.joinCommand({ ...base, project: '' }), "agent-office join https://office.example --token tok_123 --cubbies --floor plimbo --project '<local project path>'");
  assert.equal(model.joinCommand({ ...base, project: "/Users/me/it's here", cloudflare: true }), "agent-office join https://office.example --token tok_123 --cubbies --floor plimbo --project '/Users/me/it'\\''s here' --cloudflare-access");
  assert.equal(model.shellQuote('a;rm -rf /'), "'a;rm -rf /'");
  assert.equal(model.shellQuote('$(x)'), "'$(x)'");
  assert.equal(model.cleanLeadName('  Nova \n the   lead with a very long name '), 'Nova the lead with a ver');
});

test('placements turn a cubby’s own frame onto the floor', () => {
  const p = { slot: 0, x: -22, z: 5, width: 4.3, depth: 4, rotY: Math.PI / 2 };
  const door = model.toFloor(p, 0, 2);
  assert.ok(Math.abs(door.x - -20) < 1e-9 && Math.abs(door.z - 5) < 1e-9, 'a west-side cubby facing east has its door on its east side');
  const c = model.colliderOf(p, 0, 2, 2.15, 0.08, 2.7);
  assert.ok(c.maxX - c.minX < 0.2 && c.maxZ - c.minZ > 4.2);
});
