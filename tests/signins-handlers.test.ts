// Provider selection must survive the WebSocket boundary before it reaches per-account sign-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SignInKind } from '../src/shared/protocol.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import { signinsHandlers } from '../src/server/ws/handlers/signins.js';

function fixture(accountId?: string) {
  const calls: unknown[][] = [];
  const warnings: unknown[] = [];
  const record = (method: string, ...args: unknown[]) => { calls.push([method, ...args]); };
  const ctx = {
    signins: {
      start: (...args: unknown[]) => record('start', ...args),
      cancel: (...args: unknown[]) => record('cancel', ...args),
      token: async (...args: unknown[]) => record('token', ...args),
      useOffice: (...args: unknown[]) => record('useOffice', ...args),
      signOut: async (...args: unknown[]) => record('signOut', ...args),
    },
    warn: (_client: Client, message: unknown) => { warnings.push(message); },
  } as unknown as Ctx;
  return { ctx, client: { accountId } as Client, calls, warnings };
}

function actions(ctx: Ctx, client: Client, which: SignInKind) {
  signinsHandlers['signins.start'](ctx, client, { t: 'signins.start', which });
  signinsHandlers['signins.cancel'](ctx, client, { t: 'signins.cancel', which });
  signinsHandlers['signins.token'](ctx, client, { t: 'signins.token', which, token: 'test-input' });
  signinsHandlers['signins.office'](ctx, client, { t: 'signins.office', which });
  signinsHandlers['signins.signout'](ctx, client, { t: 'signins.signout', which });
}

for (const which of ['claude', 'kimi', 'codex', 'github'] as const) {
  test(`${which} sign-in actions reach the selected provider for the signed-in account`, async () => {
    const { ctx, client, calls } = fixture('acct01');
    actions(ctx, client, which);
    await Promise.resolve();
    assert.deepEqual(calls, [
      ['start', 'acct01', which],
      ['cancel', 'acct01', which],
      ['token', 'acct01', which, 'test-input'],
      ['useOffice', 'acct01', which],
      ['signOut', 'acct01', which],
    ]);
  });

  test(`${which} sign-in actions cannot run without a personal account`, async () => {
    const { ctx, client, calls, warnings } = fixture();
    actions(ctx, client, which);
    await Promise.resolve();
    assert.deepEqual(calls, []);
    assert.deepEqual(warnings, Array(5).fill("On the shared office password, workers run on the office's own sign-ins"));
  });
}
