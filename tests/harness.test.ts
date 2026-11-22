// The harness: jailed reads and writes, and pushing CLAUDE.md and skills into every agent home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    writeFileSync(path.join(root, 'CLAUDE.md'), '# taste\n');
    mkdirSync(path.join(root, 'skills', 'brand-gate'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'brand-gate', 'SKILL.md'), 'gate\n');
    writeFileSync(path.join(root, 'binary.exe'), 'nope');
    writeFileSync(path.join(root, 'big.md'), 'x'.repeat(300_000));
    assert.deepEqual(
      harness.list().map((f) => f.path),
      ['CLAUDE.md', 'skills/brand-gate/SKILL.md'],
    );
    assert.equal(harness.read('CLAUDE.md').text, '# taste\n');
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
    writeFileSync(path.join(root, 'CLAUDE.md'), '# taste\n');
    writeFileSync(path.join(root, 'WORKFLOW.md'), '# workflow\n');
    mkdirSync(path.join(root, 'skills', 'brand-gate'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'brand-gate', 'SKILL.md'), 'gate\n');
    const line = harness.apply('Jonathan');
    assert.match(line, /2 agent homes.*Claude, Kimi and Codex/);
    // Claude homes get CLAUDE.md and the skills.
    for (const dir of [office.claude, path.join(dataDir, 'homes', 'acct01', 'claude')]) {
      assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# taste\n');
      assert.equal(readFileSync(path.join(dir, 'skills', 'brand-gate', 'SKILL.md'), 'utf8'), 'gate\n');
    }
    // Kimi and Codex homes get the same instructions as one AGENTS.md, and the skills.
    for (const dir of [office.kimi, office.codex, path.join(dataDir, 'homes', 'acct01', 'kimi'), path.join(dataDir, 'homes', 'acct01', 'codex')]) {
      const agents = readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
      assert.match(agents, /<!-- Harness: CLAUDE\.md -->\n\n# taste/);
      assert.match(agents, /<!-- Harness: WORKFLOW\.md -->\n\n# workflow/);
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
    writeFileSync(path.join(root, 'CLAUDE.md'), '# taste\n');
    assert.equal(harness.optOut('acct01'), false);
    assert.equal(harness.setOptOut('acct01', true), undefined);
    assert.equal(harness.optOut('acct01'), true);
    const line = harness.apply('Jonathan');
    assert.match(line, /1 agent home.*1 running their own/);
    const home = path.join(dataDir, 'homes', 'acct01');
    assert.equal(existsSync(path.join(home, 'claude', 'CLAUDE.md')), false);
    assert.equal(existsSync(path.join(home, 'codex', 'AGENTS.md')), false);
    assert.equal(readFileSync(path.join(office.claude, 'CLAUDE.md'), 'utf8'), '# taste\n');
    assert.equal(harness.setOptOut('acct01', false), undefined);
    assert.equal(harness.optOut('acct01'), false);
    harness.apply('Jonathan');
    assert.equal(readFileSync(path.join(home, 'claude', 'CLAUDE.md'), 'utf8'), '# taste\n');
  } finally {
    cleanup();
  }
});

test('a pushed AGENTS.md keeps what it replaced as .bak', () => {
  const { dataDir, root, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# v1\n');
    harness.apply('Jonathan');
    writeFileSync(path.join(root, 'CLAUDE.md'), '# v2\n');
    harness.apply('Jonathan');
    const agents = path.join(dataDir, 'homes', 'acct01', 'codex', 'AGENTS.md');
    assert.match(readFileSync(`${agents}.bak`, 'utf8'), /# v1/);
    assert.match(readFileSync(agents, 'utf8'), /# v2/);
  } finally {
    cleanup();
  }
});
