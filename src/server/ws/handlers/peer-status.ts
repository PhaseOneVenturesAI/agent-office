// Someone's status over their head ("☕ BRB"): kept on them, so whoever arrives later sees it too.
import type { StatusClientMsg } from '../../../shared/protocol.js';
import { sameStatus, sanitizeStatus } from '../../../shared/peer-status.js';
import type { HandlerMap } from './types.js';

export const statusHandlers = {
  status(ctx, c, msg) {
    const status = sanitizeStatus(msg.status);
    if (sameStatus(status, c.peer.status)) return;
    if (status) c.peer.status = status;
    else delete c.peer.status;
    ctx.broadcast({ t: 'peer.update', peer: c.peer });
  },
} satisfies HandlerMap<StatusClientMsg>;
