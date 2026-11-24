// Satellite nodes (see server/nodes.ts): the wall for everyone, the invites and revokes for admins.
import type { NodesClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

const admin = (ctx: Ctx, c: Client): boolean => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can invite or remove machines');
  return false;
};

export const nodesHandlers = {
  'nodes.get'(ctx, c) {
    ctx.sendTo(c, { t: 'nodes', state: ctx.nodes.state() });
  },
  'nodes.invite'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const invite = ctx.nodes.invite(msg.name === undefined ? undefined : str(msg.name, 60));
    // The token goes only to who asked, and only now: the office keeps its hash, not the token.
    ctx.sendTo(c, { t: 'nodes.token', ...invite });
  },
  'nodes.revoke'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    if (!ctx.nodes.revoke(str(msg.id, 20))) ctx.warn(c, 'That machine is gone already');
  },
} satisfies HandlerMap<NodesClientMsg>;
