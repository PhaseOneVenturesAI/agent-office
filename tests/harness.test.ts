// The harness: jailed reads and writes, and pushing CLAUDE.md and skills into every agent home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Harness, harnessRoot } from '../src/server/harness.js';

function setup(): { dataDir: string; root: string; office: string; harness: Harness; cleanup: () => void } {
  const base = mkdtempSync(path.join(tmpdir(), 'agent-office-harness-'));
  const dataDir = path.join(base, 'data');
  const root = path.join(base, 'harness');
  const office = path.join(base, 'office-claude');
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

test('apply pushes CLAUDE.md and skills into the office and every account home', () => {
  const { dataDir, root, office, harness, cleanup } = setup();
  try {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# taste\n');
    mkdirSync(path.join(root, 'skills', 'brand-gate'), { recursive: true });
    writeFileSync(path.join(root, 'skills', 'brand-gate', 'SKILL.md'), 'gate\n');
    const line = harness.apply('Jonathan');
    assert.match(line, /2 agent homes/);
    for (const dir of [office, path.join(dataDir, 'homes', 'acct01', 'claude')]) {
      assert.equal(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), '# taste\n');
      assert.equal(readFileSync(path.join(dir, 'skills', 'brand-gate', 'SKILL.md'), 'utf8'), 'gate\n');
    }
    const state = harness.state();
    assert.equal(state.applied?.by, 'Jonathan');
    assert.equal(state.applied?.homes, 2);
    // And the record survives a restart of the office.
    const again = new Harness(dataDir, root, () => office, () => {});
    assert.equal(again.state().applied?.homes, 2);
  } finally {
    cleanup();
  }
});
