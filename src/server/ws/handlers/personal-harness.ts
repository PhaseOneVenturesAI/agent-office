// Each account's own harness (see server/personal-harness.ts). Every handler acts on the sender's
// own account id, never one from the message, so nobody can read or change another account's
// harness. Any signed-in member may edit their own; on the shared office password there is none.
import type { PersonalHarnessClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const NO_ACCOUNT = 'On the shared office password, everyone runs the office harness';

/** The sender's account, or a refusal: a harness of your own needs an account. */
const account = (c: Client): string => {
  if (!c.accountId || c.out) throw new Error(NO_ACCOUNT);
  return c.accountId;
};

/** Tells every browser this account has open where its harness stands, the sign-ins toggle too. */
export function sendOwnHarness(ctx: Ctx, id: string): void {
  const state = ctx.personalHarness.state(id);
  for (const c of ctx.clients.values()) {
    if (c.accountId !== id || c.out) continue;
    ctx.sendTo(c, { t: 'harness.own', state });
    ctx.sendTo(c, { t: 'harness.opt', out: state.mode === 'own' });
  }
}

/** Runs a correlated request and answers it with its result or its error. */
const answer = (ctx: Ctx, c: Client, msg: { path?: unknown; request?: unknown }, run: (id: string, path: string) => object) => {
  const request = str(msg.request, 120), path = str(msg.path, 300);
  try { ctx.sendTo(c, { t: 'harness.own.result', path, request, ...run(account(c), path) }); }
  catch (error) { ctx.sendTo(c, { t: 'harness.own.result', path, request, error: (error as Error).message }); }
};

export const personalHarnessHandlers = {
  'harness.own.get'(ctx, c) {
    if (!c.accountId) return;
    ctx.sendTo(c, { t: 'harness.own', state: ctx.personalHarness.state(c.accountId) });
  },
  'harness.own.mode'(ctx, c, msg) {
    if (!c.accountId) return ctx.warn(c, NO_ACCOUNT);
    const own = msg.own === true;
    const err = ctx.personalHarness.setOwn(c.accountId, own);
    if (err) return ctx.warn(c, err);
    sendOwnHarness(ctx, c.accountId);
    ctx.sendTo(c, { t: 'toast', text: own ? '🧰 You’re on your own harness — the office’s pushes skip your agents' : '🧰 Your agents are back on the office harness', level: 'info' });
  },
  'harness.own.read'(ctx, c, msg) {
    const request = typeof msg.request === 'string' ? str(msg.request, 120) : undefined, path = str(msg.path, 300);
    try { ctx.sendTo(c, { t: 'harness.own.file', request, ...ctx.personalHarness.read(account(c), path), path }); }
    catch (error) { ctx.sendTo(c, { t: 'harness.own.file', path, request, error: (error as Error).message }); }
  },
  'harness.own.write'(ctx, c, msg) {
    answer(ctx, c, msg, (id, path) => {
      if (typeof msg.text !== 'string') throw new Error('Missing source text');
      return ctx.personalHarness.change(id, { action: 'edit', path, text: msg.text, base: str(msg.base, 120) }, c.peer.name);
    });
  },
  'harness.own.history'(ctx, c, msg) {
    answer(ctx, c, msg, (id, path) => ({ history: ctx.personalHarness.history(id).revisions(path, msg.before === undefined ? undefined : str(msg.before, 120)) }));
  },
  'harness.own.snapshot'(ctx, c, msg) {
    answer(ctx, c, msg, (id, path) => ({ snapshot: ctx.personalHarness.history(id).snapshot(path, str(msg.revision, 120)) }));
  },
  'harness.own.restore'(ctx, c, msg) {
    answer(ctx, c, msg, (id, path) => ctx.personalHarness.change(id, { action: 'restore', path, base: str(msg.base, 120), revision: str(msg.revision, 120) }, c.peer.name));
  },
  'harness.own.create'(ctx, c, msg) {
    answer(ctx, c, msg, (id, path) => {
      if (typeof msg.text !== 'string') throw new Error('Missing source text');
      const file = ctx.personalHarness.create(id, path, msg.text);
      sendOwnHarness(ctx, id);
      return { file };
    });
  },
  'harness.own.seed'(ctx, c) {
    try {
      const id = account(c);
      const note = ctx.personalHarness.seed(id);
      sendOwnHarness(ctx, id);
      ctx.sendTo(c, { t: 'toast', text: `🧰 ${note}`, level: 'info' });
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
  'harness.own.apply'(ctx, c) {
    try {
      const id = account(c);
      const note = ctx.personalHarness.apply(id);
      sendOwnHarness(ctx, id);
      ctx.sendTo(c, { t: 'toast', text: `🧰 ${note}`, level: 'info' });
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
} satisfies HandlerMap<PersonalHarnessClientMsg>;
