// Satellite nodes (see server/nodes.ts): the wall for everyone (private machines only for their
// inviter and the admins), the invites, renames and revokes for admins.
import type { NodesClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can invite, rename or remove machines');
  return false;
};

/** Whose wall this is: private machines show only for their inviter and the admins. */
const viewer = (ctx: Ctx, c: Client) => ({ id: c.accountId, admin: ctx.meOf(c.accountId).admin });

export const nodesHandlers = {
  'nodes.get'(ctx, c) {
    ctx.sendTo(c, { t: 'nodes', state: ctx.nodes.state(viewer(ctx, c)) });
  },
  'nodes.invite'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const invite = ctx.nodes.invite(msg.name === undefined ? undefined : str(msg.name, 60), msg.visibility === 'private' ? 'private' : 'everyone', c.accountId);
    // The token goes only to who asked, and only now: the office keeps its hash, not the token.
    ctx.sendTo(c, { t: 'nodes.token', ...invite });
  },
  'nodes.rename'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const name = str(msg.name, 60).trim();
    if (!name) return ctx.warn(c, 'A machine needs a name');
    if (!ctx.nodes.rename(str(msg.id, 20), name)) ctx.warn(c, 'That machine is gone already');
  },
  'nodes.revoke'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    if (!ctx.nodes.revoke(str(msg.id, 20))) ctx.warn(c, 'That machine is gone already');
  },
} satisfies HandlerMap<NodesClientMsg>;
