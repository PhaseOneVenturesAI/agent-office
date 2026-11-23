// Each account's own harness: kept per account, edited only by its owner, applied only to that
// account's agent homes, and never touched by the office's shared push.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Harness } from '../src/server/harness.js';
import { PersonalHarness } from '../src/server/personal-harness.js';
import { personalHarnessHandlers } from '../src/server/ws/handlers/personal-harness.js';

const A = 'acctAAAA01', B = 'acctBBBB02';

function setup(t: { after: (fn: () => void) => void }) {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-personal-harness-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dataDir = path.join(base, 'data'), root = path.join(base, 'shared');
  const office = { claude: path.join(base, 'office-claude'), kimi: path.join(base, 'office-kimi'), codex: path.join(base, 'office-codex') };
  mkdirSync(root, { recursive: true });
  for (const id of [A, B]) mkdirSync(path.join(dataDir, 'homes', id, 'claude'), { recursive: true });
  const harness = new Harness(dataDir, root, () => office, () => {});
  const personal = new PersonalHarness(dataDir, harness);
  const home = (id: string, ...rest: string[]) => path.join(dataDir, 'homes', id, ...rest);
  return { dataDir, root, office, harness, personal, home };
}

/** Runs a handler as a browser signed in as `accountId` (none: the shared office password). */
function handlerRig(personal: PersonalHarness, harness: Harness) {
  const sent: { to: string | undefined; msg: any }[] = [], warned: string[] = [];
  const clients = new Map<string, any>();
  const ctx: any = { personalHarness: personal, harness, clients, sendTo: (c: any, msg: unknown) => sent.push({ to: c.accountId, msg }), warn: (_c: unknown, e: string) => warned.push(e) };
  const as = (accountId: string | undefined) => {
    const c = { id: `c-${accountId}`, accountId, peer: { name: accountId ?? 'guest' } };
    clients.set(c.id, c);
    return (name: keyof typeof personalHarnessHandlers, msg: any = {}) => { (personalHarnessHandlers[name] as any)(ctx, c, { t: name, ...msg }); return sent.at(-1)?.msg; };
  };
  return { as, sent, warned };
}

test('each account keeps its own files and history, and nobody reaches another account’s', (t) => {
  const { personal, harness, home, root } = setup(t);
  const rig = handlerRig(personal, harness);
  const asA = rig.as(A), asB = rig.as(B), guest = rig.as(undefined);

  const made = asA('harness.own.create', { path: 'CLAUDE.md', text: 'A’s own rules\n', request: 'c1' });
  assert.equal(made.error, undefined);
  assert.equal(readFileSync(home(A, 'harness', 'CLAUDE.md'), 'utf8'), 'A’s own rules\n');
  assert.equal(existsSync(path.join(root, 'CLAUDE.md')), false, 'the shared harness is untouched');

  // B sees none of A's files, and the message can't name another account or escape B's root.
  assert.deepEqual(personal.state(B).files, []);
  assert.ok(asB('harness.own.read', { path: 'CLAUDE.md', request: 'r1', accountId: A }).error);
  for (const escape of [`../../${A}/harness/CLAUDE.md`, `/${home(A, 'harness', 'CLAUDE.md')}`, '../harness/CLAUDE.md'])
    assert.ok(asB('harness.own.read', { path: escape, request: 'r2' }).error, escape);
  assert.ok(asB('harness.own.write', { path: 'CLAUDE.md', text: 'B overwrote it', base: made.file.revision, request: 'w1', accountId: A }).error);
  assert.equal(readFileSync(home(A, 'harness', 'CLAUDE.md'), 'utf8'), 'A’s own rules\n');

  // The shared office password has no harness of its own.
  assert.match(guest('harness.own.create', { path: 'CLAUDE.md', text: 'x', request: 'g' }).error, /office password/);
  guest('harness.own.mode', { own: true });
  assert.match(rig.warned.at(-1)!, /office password/);

  // A member edits their own with the content-hash base; a stale base conflicts; history is theirs.
  const saved = asA('harness.own.write', { path: 'CLAUDE.md', text: 'A’s second rules\n', base: made.file.revision, request: 'w2' });
  assert.equal(saved.error, undefined);
  assert.match(asA('harness.own.write', { path: 'CLAUDE.md', text: 'stale', base: made.file.revision, request: 'w3' }).error, /changed/);
  const history = asA('harness.own.history', { path: 'CLAUDE.md', request: 'h1' }).history;
  assert.equal(history.revisions.length, 1);
  assert.equal(history.revisions[0].by, A);
  assert.ok(asB('harness.own.history', { path: 'CLAUDE.md', request: 'h2' }).error, 'B has no view of A’s history');
  assert.deepEqual(harness.sources().historicalPaths(), [], 'personal history is not the shared harness’s');
  const restored = asA('harness.own.restore', { path: 'CLAUDE.md', base: saved.file.revision, revision: history.revisions[0].id, request: 'rs' });
  assert.equal(restored.file.text, 'A’s own rules\n');
});

test('personal files keep the shared jail: names, size, credentials and links', (t) => {
  const { personal, home, dataDir } = setup(t);
  assert.throws(() => personal.create(A, '../escape.md', 'x'), /supported file name/);
  assert.throws(() => personal.create(A, 'run.sh', 'x'), /supported file name/);
  assert.throws(() => personal.create(A, '.hidden/x.md', 'x'), /supported file name/);
  assert.throws(() => personal.create(A, 'big.md', 'x'.repeat(256_001)), /256 KB/);
  assert.throws(() => personal.create(A, 'leak.md', `token ghp_${'a'.repeat(36)}`), /credential/);
  personal.create(A, 'skills/review/SKILL.md', '# review\n');
  assert.throws(() => personal.create(A, 'skills/review/SKILL.md', 'again'), /already/);
  assert.throws(() => personal.create('../etc', 'CLAUDE.md', 'x'), /signed-in accounts/);

  // A harness folder swapped for a link to another account's is refused, never followed.
  mkdirSync(home(B, 'elsewhere'), { recursive: true });
  writeFileSync(home(B, 'elsewhere', 'CLAUDE.md'), 'B’s secret rules');
  symlinkSync(home(B, 'elsewhere'), home(B, 'harness'));
  assert.match(personal.state(B).error ?? '', /real folder/);
  assert.throws(() => personal.read(B, 'CLAUDE.md'), /real folder/);
  assert.ok(existsSync(path.join(dataDir, 'homes', A, 'harness', 'skills', 'review', 'SKILL.md')));
});

test('apply goes to your own agent homes only, with the provider mapping, once you are on your own', (t) => {
  const { personal, harness, home, office } = setup(t);
  personal.create(A, 'CLAUDE.md', '# A for Claude\n');
  personal.create(A, 'WORKFLOW.md', '# A workflow\n');
  personal.create(A, 'AGENTS.md', '# A for Kimi and Codex\n');
  personal.create(A, 'skills/ship/SKILL.md', '# ship\n');
  assert.throws(() => personal.apply(A), /Use my own harness/);
  assert.equal(personal.setOwn(A, true), undefined);
  assert.equal(harness.optOut(A), true, 'the same marker the sign-ins toggle reads');
  assert.match(personal.apply(A), /your Claude, Kimi and Codex/);
  assert.equal(readFileSync(home(A, 'claude', 'CLAUDE.md'), 'utf8'), '# A for Claude\n\n# A workflow\n');
  for (const p of ['kimi', 'codex']) assert.equal(readFileSync(home(A, p, 'AGENTS.md'), 'utf8'), '# A for Kimi and Codex\n\n# A workflow\n');
  for (const p of ['claude', 'kimi', 'codex']) assert.equal(readFileSync(home(A, p, 'skills', 'ship', 'SKILL.md'), 'utf8'), '# ship\n');
  assert.equal(existsSync(home(B, 'claude', 'CLAUDE.md')), false, 'nobody else’s home');
  assert.equal(existsSync(path.join(office.claude, 'CLAUDE.md')), false, 'not the office’s own');
  assert.equal(personal.state(A).applied?.homes, 3);
});

test('the shared push skips accounts on their own harness and never overwrites their files', (t) => {
  const { personal, harness, home, root } = setup(t);
  writeFileSync(path.join(root, 'CLAUDE.md'), '# office rules\n');
  mkdirSync(path.join(root, 'skills', 'ship'), { recursive: true });
  writeFileSync(path.join(root, 'skills', 'ship', 'SKILL.md'), '# office ship\n');
  personal.create(A, 'CLAUDE.md', '# mine\n');
  personal.create(A, 'skills/ship/SKILL.md', '# my ship\n');
  personal.setOwn(A, true);
  personal.apply(A);

  assert.match(harness.apply('Admin'), /1 running their own/);
  assert.equal(readFileSync(home(A, 'claude', 'CLAUDE.md'), 'utf8'), '# mine\n');
  assert.equal(readFileSync(home(A, 'codex', 'AGENTS.md'), 'utf8'), '# mine\n');
  assert.equal(readFileSync(home(A, 'kimi', 'skills', 'ship', 'SKILL.md'), 'utf8'), '# my ship\n');
  assert.equal(readFileSync(home(A, 'harness', 'CLAUDE.md'), 'utf8'), '# mine\n');
  assert.equal(readFileSync(home(A, 'harness', 'skills', 'ship', 'SKILL.md'), 'utf8'), '# my ship\n');
  // B is on the office's: the push reaches them.
  assert.equal(readFileSync(home(B, 'claude', 'CLAUDE.md'), 'utf8'), '# office rules\n');

  // Back on the office's, A's agents get the shared push; A's own sources still stay as they were.
  personal.setOwn(A, false);
  harness.apply('Admin');
  assert.equal(readFileSync(home(A, 'claude', 'CLAUDE.md'), 'utf8'), '# office rules\n');
  assert.equal(readFileSync(home(A, 'harness', 'CLAUDE.md'), 'utf8'), '# mine\n');
});

test('starting from the office’s harness copies its defaults and skills, keeping what you have', (t) => {
  const { personal, root, home } = setup(t);
  writeFileSync(path.join(root, 'CLAUDE.md'), '# office rules\n');
  writeFileSync(path.join(root, 'WORKFLOW.md'), '# office workflow\n');
  writeFileSync(path.join(root, 'notes.md'), 'not a default');
  mkdirSync(path.join(root, 'skills', 'ship'), { recursive: true });
  writeFileSync(path.join(root, 'skills', 'ship', 'SKILL.md'), '# office ship\n');
  personal.create(A, 'WORKFLOW.md', '# my workflow\n');
  assert.match(personal.seed(A), /copied 2 files.*kept 1 of yours/);
  assert.equal(readFileSync(home(A, 'harness', 'CLAUDE.md'), 'utf8'), '# office rules\n');
  assert.equal(readFileSync(home(A, 'harness', 'WORKFLOW.md'), 'utf8'), '# my workflow\n');
  assert.equal(readFileSync(home(A, 'harness', 'skills', 'ship', 'SKILL.md'), 'utf8'), '# office ship\n');
  assert.equal(existsSync(home(A, 'harness', 'notes.md')), false);
  assert.deepEqual(personal.state(A).files.map((f) => f.path).sort(), ['CLAUDE.md', 'WORKFLOW.md', 'skills/ship/SKILL.md']);
});

test('choosing a mode tells every browser of that account, and the sign-ins toggle with it', (t) => {
  const { personal, harness } = setup(t);
  const rig = handlerRig(personal, harness);
  const asA = rig.as(A); rig.as(B);
  asA('harness.own.mode', { own: true });
  const toA = rig.sent.filter((s) => s.to === A).map((s) => s.msg);
  assert.ok(toA.some((m) => m.t === 'harness.own' && m.state.mode === 'own'));
  assert.ok(toA.some((m) => m.t === 'harness.opt' && m.out === true));
  assert.equal(rig.sent.filter((s) => s.to === B).length, 0);
  assert.equal(harness.optOut(A), true);
});
