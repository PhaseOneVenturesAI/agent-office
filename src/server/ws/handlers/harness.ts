// The office's harness (see server/harness.ts): admins read, edit and push the instruction and
// skill files every worker runs with.
import type { HarnessClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

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
    ctx.sendTo(c, { t: 'harness.file', path, text: r.text, error: r.error });
  },
  'harness.write'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const err = ctx.harness.write(str(msg.path, 300), str(msg.text, 300_000));
    if (err) return ctx.warn(c, err);
    ctx.toastAll(`🧰 ${c.peer.name} updated the harness (${str(msg.path, 120)})`);
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
    ctx.sendTo(c, { t: 'harness.opt', out });
    ctx.sendTo(c, { t: 'toast', text: out ? '🧰 Harness pushes now skip your agents — you run your own' : '🧰 Your agents are back on the office harness', level: 'info' });
  },
} satisfies HandlerMap<HarnessClientMsg>;
