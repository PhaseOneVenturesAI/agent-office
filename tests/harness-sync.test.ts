import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Harness } from '../src/server/harness.js';
import { PersonalHarness } from '../src/server/personal-harness.js';
import { HarnessSync } from '../src/server/harness-sync.js';

function setup(t: test.TestContext) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'office-harness-sync-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'source'), data = path.join(base, 'data');
  mkdirSync(root); mkdirSync(data);
  const homes = { claude: path.join(base, 'claude'), kimi: path.join(base, 'kimi'), codex: path.join(base, 'codex') };
  const harness = new Harness(data, root, () => homes, () => {});
  const put = (rel: string, text: string) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  return { base, root, data, homes, harness, put };
}

test('retired managed skills and removed instructions stop loading, with old text backed up', (t) => {
  const { root, homes, harness, put } = setup(t);
  put('CLAUDE.md', 'current workflow'); put('skills/retired/SKILL.md', 'old direction');
  harness.apply('Owner');
  rmSync(path.join(root, 'CLAUDE.md')); rmSync(path.join(root, 'skills/retired/SKILL.md'));
  harness.apply('Owner');
  for (const [provider, home] of Object.entries(homes)) {
    const instructions = provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    assert.equal(existsSync(path.join(home, instructions)), false);
    assert.equal(existsSync(path.join(home, 'skills/retired/SKILL.md')), false);
    assert.ok(readdirSync(home).some((f) => f.startsWith(instructions + '.harness-')));
    const archived = readdirSync(path.join(home, 'skills/retired')).find((f) => f.endsWith('.bak'))!;
    assert.equal(readFileSync(path.join(home, 'skills/retired', archived), 'utf8'), 'old direction');
  }
});

test('a locally edited managed skill is preserved when its source changes or disappears', (t) => {
  const { root, homes, harness, put } = setup(t);
  put('skills/retired/SKILL.md', 'original'); harness.apply('Owner');
  const file = path.join(homes.kimi, 'skills/retired/SKILL.md');
  writeFileSync(file, 'personal edit'); put('skills/retired/SKILL.md', 'new shared text');
  assert.match(harness.apply('Owner'), /conflict/i);
  assert.equal(readFileSync(file, 'utf8'), 'personal edit');
  rmSync(path.join(root, 'skills/retired/SKILL.md')); harness.apply('Owner');
  assert.equal(readFileSync(file, 'utf8'), 'personal edit');
});

test('legacy untracked files and unrelated skills are preserved rather than assumed managed', (t) => {
  const { homes, harness, put } = setup(t);
  mkdirSync(path.join(homes.claude, 'skills/personal'), { recursive: true });
  writeFileSync(path.join(homes.claude, 'CLAUDE.md'), 'my own instructions');
  writeFileSync(path.join(homes.claude, 'skills/personal/SKILL.md'), 'my skill');
  put('CLAUDE.md', 'office workflow');
  assert.match(harness.apply('Owner'), /conflict/i);
  assert.equal(readFileSync(path.join(homes.claude, 'CLAUDE.md'), 'utf8'), 'my own instructions');
  assert.equal(readFileSync(path.join(homes.claude, 'skills/personal/SKILL.md'), 'utf8'), 'my skill');
});

test('personal apply filters retired review rules like shared apply and rejects incomplete markers', (t) => {
  const { data, harness } = setup(t), id = 'account01';
  const personal = new PersonalHarness(data, harness);
  personal.create(id, 'CLAUDE.md', 'keep\n<!-- review-ratchet:start -->never use Plimbo gradients<!-- review-ratchet:end -->\n');
  personal.setOwn(id, true); personal.apply(id);
  assert.equal(readFileSync(path.join(data, 'homes', id, 'kimi/AGENTS.md'), 'utf8'), 'keep\n');
  const file = personal.read(id, 'CLAUDE.md');
  personal.change(id, { action: 'edit', path: 'CLAUDE.md', base: file.revision, text: '<!-- review-ratchet:start -->broken' }, 'Owner');
  assert.throws(() => personal.apply(id), /incomplete legacy review block/);
});

test('personal source retirement uses the same managed sync, preserving source history and other users', (t) => {
  const { data, harness } = setup(t), id = 'account01';
  const personal = new PersonalHarness(data, harness);
  personal.create(id, 'CLAUDE.md', 'only instruction');
  personal.create(id, 'skills/old/SKILL.md', 'old skill');
  personal.setOwn(id, true); personal.apply(id);
  for (const rel of ['CLAUDE.md', 'skills/old/SKILL.md']) {
    const source = personal.read(id, rel);
    personal.change(id, { action: 'edit', path: rel, base: source.revision, text: 'retiring' }, 'Owner');
    rmSync(path.join(personal.state(id).root, rel));
  }
  personal.apply(id);
  for (const provider of ['claude', 'kimi', 'codex']) {
    assert.equal(existsSync(path.join(data, 'homes', id, provider, provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md')), false);
    assert.equal(existsSync(path.join(data, 'homes', id, provider, 'skills/old/SKILL.md')), false);
  }
  assert.equal(personal.history(id).revisions('CLAUDE.md').revisions.length, 1);
});


test('preview is read-only and a changed source or destination invalidates it', (t) => {
  const { root, data, homes, put } = setup(t);
  put('skills/ship/SKILL.md', 'one');
  const sync = new HarnessSync(data);
  const preview = sync.preview(homes.claude, root, 'CLAUDE.md', 'instructions');
  assert.equal(existsSync(homes.claude), false);
  assert.equal(existsSync(path.join(data, 'harness-managed')), false);
  put('skills/ship/SKILL.md', 'two');
  assert.throws(() => sync.apply(homes.claude, root, 'CLAUDE.md', 'instructions', preview), /changed since preview/);
  assert.equal(existsSync(homes.claude), false);
  const current = sync.preview(homes.claude, root, 'CLAUDE.md', 'instructions');
  sync.apply(homes.claude, root, 'CLAUDE.md', 'instructions', current);
  const next = sync.preview(homes.claude, root, 'CLAUDE.md', 'new instructions');
  writeFileSync(path.join(homes.claude, 'CLAUDE.md'), 'local edit');
  assert.throws(() => sync.apply(homes.claude, root, 'CLAUDE.md', 'new instructions', next), /changed since preview/);
  assert.equal(readFileSync(path.join(homes.claude, 'CLAUDE.md'), 'utf8'), 'local edit');
});

test('manifest corruption and unsafe source trees fail before retiring anything', (t) => {
  const { root, data, homes, harness, put } = setup(t);
  put('skills/ship/SKILL.md', 'keep'); harness.apply('Owner');
  rmSync(path.join(root, 'skills/ship/SKILL.md'));
  symlinkSync(path.join(root, 'missing'), path.join(root, 'skills/ship/SKILL.md'));
  assert.throws(() => harness.apply('Owner'), /Unsafe harness source/);
  assert.equal(readFileSync(path.join(homes.claude, 'skills/ship/SKILL.md'), 'utf8'), 'keep');
  rmSync(path.join(root, 'skills/ship/SKILL.md'));
  const manifests = path.join(data, 'harness-managed');
  for (const file of readdirSync(manifests)) writeFileSync(path.join(manifests, file), '{broken');
  assert.throws(() => harness.apply('Owner'));
  assert.equal(readFileSync(path.join(homes.claude, 'skills/ship/SKILL.md'), 'utf8'), 'keep');
});

test('source script permissions survive initial install and local modes survive updates', (t) => {
  const { root, homes, harness, put } = setup(t);
  put('skills/ship/run.sh', '#!/bin/sh\necho one');
  const file = path.join(root, 'skills/ship/run.sh');
  // A skill may legitimately ship executable supporting scripts.
  chmodSync(file, 0o755); harness.apply('Owner');
  const target = path.join(homes.claude, 'skills/ship/run.sh');
  assert.equal(statSync(target).mode & 0o777, 0o755);
  chmodSync(target, 0o700); put('skills/ship/run.sh', '#!/bin/sh\necho two');
  harness.apply('Owner');
  assert.equal(statSync(target).mode & 0o777, 0o700);
});
