import type { VoiceIceClientMsg } from '../../../shared/protocol.js';
import { issueTurn } from '../../turn.js';
import { throttle } from '../../office/client.js';
import type { HandlerMap } from './types.js';

export const voiceIceHandlers = {
  'voice.ice'(ctx, c, msg) {
    if (typeof msg.requestId !== 'string' || msg.requestId.length > 80) return;
    // Only an authenticated, still-present 3D session; recheck account revocation on every renewal.
    const allowed = !c.out && ctx.stillIn(c) && !c.peer.lite &&
      (c.accountId ? !!ctx.accounts.get(c.accountId) : ctx.accounts.sharedPassword);
    if (!allowed) return ctx.sendTo(c, { t: 'voice.ice', requestId: msg.requestId, ice: [], error: 'Sign in again to renew voice relay access.' });
    if (!throttle(c, 'voice.ice', 10_000)) return;
    const turn = ctx.cfg.turn && issueTurn(ctx.cfg.turn, c.accountId ?? `session:${c.id}`);
    ctx.sendTo(c, { t: 'voice.ice', requestId: msg.requestId, ice: [...ctx.cfg.iceServers, ...(turn?.ice ?? [])], expiresAt: turn?.expiresAt });
  },
} satisfies HandlerMap<VoiceIceClientMsg>;
