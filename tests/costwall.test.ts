// The cost wall: adding every agent's session usage up per person and per provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/server/costwall.js';
import type { Ledger } from '../src/server/usage.js';
import type { Usage, WorkerInfo } from '../src/shared/protocol.js';

const usage = (over: Partial<Usage> = {}): Usage => ({ input: 100, output: 50, cacheWrite: 0, cacheRead: 0, cost: 0.25, calls: 2, ...over });

/** A minimal agent worker; aggregate only reads kind, provider, createdBy and usage. */
const worker = (createdBy: string, provider: string, u?: Usage): WorkerInfo => ({ kind: 'agent', provider, createdBy, ...(u ? { usage: u } : {}) }) as unknown as WorkerInfo;

const ledger = { state: () => ({ total: usage(), today: usage(), day: '2026-11-22', pauseHiring: false }) } as Ledger;

test("each person's spend adds up per provider, biggest first", () => {
  const state = aggregate(
    [
      worker('Ada', 'claude', usage({ cost: 1.5 })),
      worker('Ada', 'codex', usage({ cost: 0, costKnown: false })),
      worker('Bo', 'claude', usage({ cost: 3 })),
      worker('Bo', 'claude', usage({ cost: 1 })),
    ],
    ledger,
  );
  assert.deepEqual(
    state.rows.map((r) => r.name),
    ['Bo', 'Ada'],
    'biggest known spend first',
  );
  const bo = state.rows[0];
  assert.equal(bo.providers.claude?.workers, 2);
  assert.equal(bo.providers.claude?.usage.cost, 4);
  assert.equal(bo.total.cost, 4);
  assert.equal(bo.costKnown, true);
  const ada = state.rows[1];
  assert.equal(ada.providers.claude?.usage.cost, 1.5);
  assert.equal(ada.providers.codex?.costKnown, false, "Codex's tokens can't be priced");
  assert.equal(ada.costKnown, false, 'one unknown cell marks the row');
  assert.equal(state.office.calls, 8, 'the office adds every agent up');
  assert.equal(state.costKnown, false);
});

test('an authoritative totalTokens is kept only when every reporter brought one', () => {
  const both = aggregate([worker('Ada', 'codex', usage({ totalTokens: 150 })), worker('Ada', 'codex', usage({ totalTokens: 250 }))], ledger);
  assert.equal(both.rows[0].providers.codex?.usage.totalTokens, 400);

  const mixed = aggregate([worker('Ada', 'codex', usage({ totalTokens: 150 })), worker('Ada', 'codex', usage())], ledger);
  assert.equal(mixed.rows[0].providers.codex?.usage.totalTokens, undefined, 'a partial total would mislead');
});

test('fresh hires count as workers without numbers; shells stay off the wall', () => {
  const state = aggregate([worker('Ada', 'claude'), worker('Ada', 'claude', usage()), { kind: 'shell', createdBy: 'Ada' } as unknown as WorkerInfo], ledger);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].providers.claude?.workers, 2, 'the fresh hire counts');
  assert.equal(state.rows[0].providers.claude?.usage.cost, 0.25, 'only the reported session adds numbers');
  assert.equal(state.office.cost, 0.25, 'the shell never reaches the wall');
  assert.equal(state.office.calls, 2);
});
