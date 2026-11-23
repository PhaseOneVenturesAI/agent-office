// The harness: jailed reads and writes, and pushing CLAUDE.md and skills into every agent home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Harness, harnessRoot } from '../src/server/harness.js';

function setup(): { dataDir: string; root: string; office: { claude: string; kimi: string; codex: string }; harness: Harness; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-harness-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  const office = { claude: path.join(base, 'office-claude'), kimi: path.join(base, 'office-kimi'), codex: path.join(base, 'office-codex') };
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(dataDir, 'homes', 'acct01', 'claude'), { recursive: true });
  const harness = new Harness(dataDir, root, () => office, () => {});
  return { dataDir, root, office, harness, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('the root is AGENT_OFFICE_HARNESS, then ~/Documents/AgentHarness, then the data dir', () => {
  assert.equal(harnessRoot('/data', { AGENT_OFFICE_HARNESS: '/elsewhere' } as never), '/elsewhere');
  const fallback = harnessRoot('/data', {} as never);
  assert.ok(fallback === path.join('/data', 'harness') || fallback.endsWith(path.join('Documents', 'AgentHarness')));
});

test('files are listed jailed to instructions kinds, and reads stay inside the root', () => {
  const { root, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# shared defaults\n');
    mkdirSync(path.join(root, 'skills', 'brand-gate'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'brand-gate', 'SKILL.md'), 'gate\n');
    writeFileSync(path.join(root, 'binary.exe'), 'nope');
    writeFileSync(path.join(root, 'big.md'), 'x'.repeat(300_000));
    assert.deepEqual(
      harness.list().map((f) => f.path),
      ['CLAUDE.md', 'skills/brand-gate/SKILL.md'],
    );
    assert.equal(harness.read('CLAUDE.md').text, '# shared defaults\n');
    assert.ok(harness.read('../outside.md').error);
    assert.ok(harness.read('/etc/passwd').error);
    assert.ok(harness.read('binary.exe').error);
  } finally {
    cleanup();
  }
});

test('writes keep a .bak, refuse escapes, and the backup stays out of the list', () => {
  const { root, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'WORKFLOW.md'), 'v1\n');
    assert.equal(harness.write('WORKFLOW.md', 'v2\n'), undefined);
    assert.equal(readFileSync(path.join(root, 'WORKFLOW.md'), 'utf8'), 'v2\n');
    assert.equal(readFileSync(path.join(root, 'WORKFLOW.md.bak'), 'utf8'), 'v1\n');
    assert.deepEqual(harness.list().map((f) => f.path), ['WORKFLOW.md']);
    assert.ok(harness.write('../evil.md', 'x'));
    assert.ok(harness.write('script.sh', 'x'));
    assert.equal(existsSync(path.join(root, '..', 'evil.md')), false);
  } finally {
    cleanup();
  }
});

test('apply pushes CLAUDE.md, AGENTS.md and skills into the office and every account home', () => {
  const { dataDir, root, office, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# shared defaults\n');
    writeFileSync(path.join(root, 'WORKFLOW.md'), '# workflow\n');
    mkdirSync(path.join(root, 'skills', 'brand-gate'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'brand-gate', 'SKILL.md'), 'gate\n');
    const line = harness.apply('Jonathan');
    assert.match(line, /2 agent homes.*Claude, Kimi and Codex/);
    // Every provider gets identical shared defaults and skills.
    for (const dir of [office.claude, path.join(dataDir, 'homes', 'acct01', 'claude')]) {
      assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# shared defaults\n\n# workflow\n');
      assert.equal(readFileSync(path.join(dir, 'skills', 'brand-gate', 'SKILL.md'), 'utf8'), 'gate\n');
    }
    // Kimi and Codex homes get the same instructions as one AGENTS.md, and the skills.
    for (const dir of [office.kimi, office.codex, path.join(dataDir, 'homes', 'acct01', 'kimi'), path.join(dataDir, 'homes', 'acct01', 'codex')]) {
      const agents = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
      assert.equal(agents, readFileSync(path.join(office.claude, 'CLAUDE.md'), 'utf8'));
      assert.equal(readFileSync(path.join(dir, 'skills', 'brand-gate', 'SKILL.md'), 'utf8'), 'gate\n');
    }
    const state = harness.state();
    assert.equal(state.applied?.by, 'Jonathan');
    // Six dirs: the office's three plus the account's three.
    assert.equal(state.applied?.homes, 6);
    // And the record survives a restart of the office.
    const again = new Harness(dataDir, root, () => office, () => {});
    assert.equal(again.state().applied?.homes, 6);
  } finally {
    cleanup();
  }
});

test('an account that runs its own harness is skipped by apply, and rejoins when back', () => {
  const { dataDir, root, office, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# shared defaults\n');
    assert.equal(harness.optOut('acct01'), false);
    assert.equal(harness.setOptOut('acct01', true), undefined);
    assert.equal(harness.optOut('acct01'), true);
    const line = harness.apply('Jonathan');
    assert.match(line, /1 agent home.*1 running their own/);
    const home = path.join(dataDir, 'homes', 'acct01');
    assert.equal(existsSync(path.join(home, 'claude', 'CLAUDE.md')), false);
    assert.equal(existsSync(path.join(home, 'codex', 'AGENTS.md')), false);
    assert.equal(readFileSync(path.join(office.claude, 'CLAUDE.md'), 'utf8'), '# shared defaults\n');
    assert.equal(harness.setOptOut('acct01', false), undefined);
    assert.equal(harness.optOut('acct01'), false);
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(home, 'claude', 'CLAUDE.md'), 'utf8'), '# shared defaults\n');
  } finally {
    cleanup();
  }
});

test('changed instructions for every provider keep unique backups across repeated pushes', () => {
  const { dataDir, root, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# v1\n');
    harness.apply('Jonathan');
    writeFileSync(path.join(root, 'CLAUDE.md'), '# v2\n');
    harness.apply('Jonathan');
    writeFileSync(path.join(root, 'CLAUDE.md'), '# v3\n');
    harness.apply('Jonathan');
    for (const provider of ['claude', 'kimi', 'codex']) {
      const dir = path.join(dataDir, 'homes', 'acct01', provider);
      const name = provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
      const backups = readdirSync(dir).filter((n) => n.startsWith(`${name}.harness-`) && n.endsWith('.bak'));
      assert.equal(backups.length, 2);
      assert.deepEqual(backups.map((n) => readFileSync(path.join(dir, n), 'utf8')).sort(), ['# v1\n', '# v2\n']);
      assert.equal(readFileSync(path.join(dir, name), 'utf8'), '# v3\n');
    }
  } finally {
    cleanup();
  }
});


test('only explicit shared defaults reach all providers, deduplicated without legacy review evidence', () => {
  const { root, office, harness, cleanup } = setup();
  try {
    const defaults = '# Shared workflow\nKeep project decisions in their project.';
    const legacy = '<!-- review-ratchet:start -->\nReject all gradients for Plimbo.\n<!-- review-ratchet:end -->';
    writeFileSync(path.join(root, 'CLAUDE.md'), `${defaults}\n${legacy}\n`);
    writeFileSync(path.join(root, 'WORKFLOW.md'), `${defaults}\r\n`);
    for (const name of ['taste-plimbo.md', 'PROJECT.md', 'reviews.md', 'history.md']) {
      writeFileSync(path.join(root, name), `Do not inject ${name}`);
    }
    harness.apply('Jonathan');
    for (const [provider, dir] of Object.entries(office)) {
      const file = path.join(dir, provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
      assert.equal(readFileSync(file, 'utf8'), `${defaults}\n`);
    }
    assert.equal(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), `${defaults}\n${legacy}\n`, 'source history is preserved');
    assert.equal(harness.read('taste-plimbo.md').text, 'Do not inject taste-plimbo.md', 'excluded files stay available to edit');
  } finally {
    cleanup();
  }
});

test('legacy review-only defaults clear old generated rules without losing surrounding instructions or source evidence', () => {
  const { root, office, harness, cleanup } = setup();
  try {
    const legacy = '<!-- review-ratchet:start -->\nOld Plimbo verdict\n<!-- review-ratchet:end -->';
    writeFileSync(path.join(root, 'CLAUDE.md'), `before\n${legacy}\nafter`);
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(office.claude, 'CLAUDE.md'), 'utf8'), 'before\n\nafter\n');
    writeFileSync(path.join(root, 'CLAUDE.md'), legacy);
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(office.claude, 'CLAUDE.md'), 'utf8'), '');
    assert.equal(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), legacy);
  } finally {
    cleanup();
  }
});

test('push preserves unrelated skills and personal instructions in backups, without pruning removed shared files', () => {
  const { root, office, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# shared\n');
    const source = path.join(root, 'skills', 'review');
    const target = path.join(office.claude, 'skills', 'review');
    mkdirSync(source, { recursive: true });
    mkdirSync(target, { recursive: true });
    mkdirSync(path.join(office.claude, 'skills', 'personal'), { recursive: true });
    writeFileSync(path.join(office.claude, 'CLAUDE.md'), '# personal instructions\n');
    writeFileSync(path.join(source, 'SKILL.md'), '# shared skill\n');
    writeFileSync(path.join(target, 'SKILL.md'), '# personal version\n');
    writeFileSync(path.join(target, 'notes.md'), 'personal notes');
    writeFileSync(path.join(office.claude, 'skills', 'personal', 'SKILL.md'), 'unrelated skill');
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(target, 'notes.md'), 'utf8'), 'personal notes');
    assert.equal(readFileSync(path.join(office.claude, 'skills', 'personal', 'SKILL.md'), 'utf8'), 'unrelated skill');
    const backup = readdirSync(target).find((n) => n.endsWith('.bak'))!;
    assert.equal(readFileSync(path.join(target, backup), 'utf8'), '# personal version\n');
    const instructionsBackup = readdirSync(office.claude).find((n) => n.startsWith('CLAUDE.md.harness-'))!;
    assert.equal(readFileSync(path.join(office.claude, instructionsBackup), 'utf8'), '# personal instructions\n');
    rmSync(path.join(source, 'SKILL.md'));
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(target, 'SKILL.md'), 'utf8'), '# shared skill\n', 'push does not silently remove files');
    assert.equal(readdirSync(target).filter((n) => n.endsWith('.bak')).length, 1, 'unchanged pushes do not overwrite historical backups');
  } finally {
    cleanup();
  }
});

test('push reports and skips destination symlinks instead of overwriting their targets', () => {
  const { root, office, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# shared\n');
    mkdirSync(office.claude, { recursive: true });
    const personal = path.join(root, 'personal.md');
    writeFileSync(personal, 'personal instructions');
    symlinkSync(personal, path.join(office.claude, 'CLAUDE.md'));
    const line = harness.apply('Jonathan');
    assert.match(line, /skipped 1 symlink/);
    assert.equal(readFileSync(personal, 'utf8'), 'personal instructions');
  } finally {
    cleanup();
  }
});
