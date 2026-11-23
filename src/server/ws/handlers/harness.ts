// The office's harness (see server/harness.ts): admins read, edit and push the instruction and
// skill files every worker runs with.
import type { HarnessClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';
import { sendOwnHarness } from './personal-harness.js';

/** Whether `c` may touch the harness; if not, they're told so. Reading the list is fine for everyone. */
const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can change the harness');
  return false;
};

export const harnessHandlers = {
  'harness.get'(ctx, c) {
    ctx.sendTo(c, { t: 'harness', state: ctx.harness.state() });
  },
  'harness.read'(ctx, c, msg) {
    const path = str(msg.path, 300);
    const r = ctx.harness.read(path);
    ctx.sendTo(c, { t: 'harness.file', path, ...r, request: typeof msg.request === 'string' ? str(msg.request, 120) : undefined });
  },
  'harness.write'(ctx, c, msg) {
    const request = str(msg.request, 120), path = str(msg.path, 300);
    try {
      if (!ctx.meOf(c.accountId).admin) throw new Error('Only admins can change the harness');
      if (typeof msg.text !== 'string') throw new Error('Missing source text');
      const result = ctx.harness.change({ action: 'edit', path, text: msg.text, base: str(msg.base, 120) }, c.peer.name);
      ctx.sendTo(c, { t: 'harness.result', path, request, ...result });
    } catch (error) { ctx.sendTo(c, { t: 'harness.result', path, request, error: (error as Error).message }); }
  },
  'harness.history'(ctx, c, msg) {
    const request = str(msg.request, 120), path = str(msg.path, 300);
    try { ctx.sendTo(c, { t: 'harness.result', path, request, history: ctx.harness.sources().revisions(path, msg.before === undefined ? undefined : str(msg.before, 120)) }); }
    catch (error) { ctx.sendTo(c, { t: 'harness.result', path, request, error: (error as Error).message }); }
  },
  'harness.snapshot'(ctx, c, msg) {
    const request = str(msg.request, 120), path = str(msg.path, 300);
    try { ctx.sendTo(c, { t: 'harness.result', path, request, snapshot: ctx.harness.sources().snapshot(path, str(msg.revision, 120)) }); }
    catch (error) { ctx.sendTo(c, { t: 'harness.result', path, request, error: (error as Error).message }); }
  },
  'harness.restore'(ctx, c, msg) {
    const request = str(msg.request, 120), path = str(msg.path, 300);
    try {
      if (!ctx.meOf(c.accountId).admin) throw new Error('Only admins can change the harness');
      const result = ctx.harness.change({ action: 'restore', path, base: str(msg.base, 120), revision: str(msg.revision, 120) }, c.peer.name);
      ctx.sendTo(c, { t: 'harness.result', path, request, ...result });
    } catch (error) { ctx.sendTo(c, { t: 'harness.result', path, request, error: (error as Error).message }); }
  },
  'harness.apply'(ctx, c) {
    if (!admin(ctx, c)) return;
    ctx.toastAll(`🧰 ${ctx.harness.apply(c.peer.name)}`);
  },
  'harness.optget'(ctx, c) {
    if (!c.accountId) return;
    ctx.sendTo(c, { t: 'harness.opt', out: ctx.harness.optOut(c.accountId) });
  },
  'harness.opt'(ctx, c, msg) {
    if (!c.accountId) return ctx.warn(c, 'On the shared office password, everyone runs the office harness');
    const err = ctx.harness.setOptOut(c.accountId, msg.out === true);
    if (err) return ctx.warn(c, err);
    const out = msg.out === true;
    // Every browser this account has open, the 🧰 Harness window's choice included.
    sendOwnHarness(ctx, c.accountId);
    ctx.sendTo(c, { t: 'toast', text: out ? '🧰 Harness pushes now skip your agents — you run your own' : '🧰 Your agents are back on the office harness', level: 'info' });
  },
} satisfies HandlerMap<HarnessClientMsg>;
