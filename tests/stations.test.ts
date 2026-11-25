import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_ONLY_LEAD_DISALLOWED_TOOLS, stationBrief, stationDisallowedTools, stationWorktree } from '../src/server/stations.js';
import { claude } from '../src/server/providers/claude.js';
import { STATION_AGENT, STATION_KINDS, STATIONS } from '../src/shared/layout.js';
import { checkCustomMaps, planMap } from '../src/shared/maps/index.js';
import { CASTLE } from '../src/shared/maps/castle.js';

test('the office has three leads: Product, Development and Marketing', () => {
  assert.deepEqual([...STATION_KINDS], ['product', 'development', 'marketing']);
  assert.deepEqual(STATION_KINDS.map((k) => STATION_AGENT[k].name), ['Product lead', 'Development lead', 'Marketing lead']);
  assert.deepEqual(STATIONS.map((s) => s.id), ['station-product', 'station-development', 'station-marketing']);
});

test('every lead can hire workers with office-workers and reach the queue with office-queue, not its own curl calls', () => {
  for (const kind of STATION_KINDS) {
    const brief = stationBrief(kind);
    assert.match(brief, new RegExp(STATION_AGENT[kind].name), kind);
    assert.match(brief, /office-workers hire/, kind);
    assert.match(brief, /office-workers list/, kind);
    assert.match(brief, /office-workers home/, kind);
    assert.match(brief, /office-queue list/, kind);
    assert.match(brief, /office-queue add --title "[^"]+"/, kind);
    assert.match(brief, /<<'EOF'/, `${kind}: prompts go in a quoted heredoc`);
    assert.match(brief, /office-queue remove <id>/, kind);
    assert.doesNotMatch(brief, /curl|\/office\/queue|AGENT_OFFICE_HOOK_TOKEN|Authorization/, kind);
    assert.match(brief, /say in a few lines what you did, with links/, kind);
    // The request is typed in right after it.
    assert.ok(brief.endsWith('The request:'), kind);
  }
});

test('the product lead owns the issues and specs, and hands building to the queue', () => {
  const brief = stationBrief('product');
  assert.match(brief, /GitHub issues with the gh CLI/);
  assert.match(brief, /acceptance criteria/);
  assert.match(brief, /spec writer/);
  assert.match(brief, /You don't write code/);
});

test('the development lead writes code in its own worktree, on a fresh branch for each piece of work, and reviews PRs', () => {
  const brief = stationBrief('development');
  assert.match(brief, /worktree of your own/);
  assert.match(brief, /git switch -c <short-branch-name> origin\/main/);
  assert.match(brief, /gh pr create/);
  assert.match(brief, /gh pr diff/);
  assert.match(brief, /never switch branches, commit or edit files there/);
});

test('the marketing lead writes from what merged, and never changes the shared checkout itself', () => {
  const brief = stationBrief('marketing');
  assert.match(brief, /release notes/);
  assert.match(brief, /gh pr list --state merged/);
  assert.match(brief, /never claim something the product doesn't do/);
  assert.match(brief, /copywriter/);
  assert.match(brief, /don't switch branches, commit, or create, edit or delete files in it/);
});

test('only the development lead gets a worktree and its editing tools; the others are launched read only', () => {
  assert.deepEqual(STATION_KINDS.filter(stationWorktree), ['development']);
  assert.deepEqual(READ_ONLY_LEAD_DISALLOWED_TOOLS, ['Edit', 'Write', 'NotebookEdit']);
  assert.deepEqual(stationDisallowedTools('development'), []);
  for (const kind of ['product', 'marketing'] as const) assert.deepEqual(stationDisallowedTools(kind), READ_ONLY_LEAD_DISALLOWED_TOOLS);
});

test("Claude Code leads are launched with their disallowed tools, and the development lead with all of them", () => {
  const launch = (station: (typeof STATION_KINDS)[number]) =>
    claude.launch({ h: { info: {} } as never, args: [], prompt: 'hi', station, cwd: '.', setup: { settings: 's.json' } } as never).args;
  const flagged = (args: string[]) => (args.includes('--disallowedTools') ? args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--disallowedTools') + 4) : []);
  assert.deepEqual(flagged(launch('product')), ['Edit', 'Write', 'NotebookEdit']);
  assert.deepEqual(flagged(launch('marketing')), ['Edit', 'Write', 'NotebookEdit']);
  assert.deepEqual(flagged(launch('development')), []);
});

test('a map written for the Issues, Queue and PR agents puts the leads in their places', () => {
  const old = { id: 'old-hall', name: 'Old hall', extends: 'castle', stations: { issues: { z: -12 } } };
  const [loaded] = checkCustomMaps([{ file: 'old-hall.json', json: old }]);
  assert.equal(loaded.error, undefined);
  const full = loaded.config!;
  assert.deepEqual(Object.keys(full.stations).sort(), ['development', 'marketing', 'product']);
  assert.deepEqual(full.stations.product, { ...CASTLE.stations.product, z: -12 });
  assert.deepEqual(full.stations.development, CASTLE.stations.development);
  assert.deepEqual(planMap(full).stations.map((s) => s.station), ['product', 'development', 'marketing']);
});
