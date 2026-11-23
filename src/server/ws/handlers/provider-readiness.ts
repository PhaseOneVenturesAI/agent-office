import type { ProviderReadinessClientMsg, SignInKind } from '../../../shared/protocol.js';
import { providerReadiness } from '../../provider-readiness.js';
import { providerCommand } from '../../agents.js';
import { resolveCommand } from '../../workers.js';
import type { HandlerMap } from './types.js';

export const readinessHandlers = {
  'readiness.get'(ctx, c) {
    const id = c.accountId;
    if (!id) return ctx.warn(c, 'Sign in with your own Office account to inspect provider readiness.');
    // Reuse the sign-in check already in flight; no additional polling or model-list requests.
    void ctx.signins.look(id).then(() => {
      if (c.out || !ctx.stillIn(c)) return;
      const state = ctx.signins.state(id);
      const workers = ctx.floorOf(c)?.workers;
      const own = workers?.list().filter((w) => workers.ownerOf(w.id) === id) ?? [];
      const providers = (['claude', 'kimi', 'codex', 'github'] as SignInKind[]).map((p) => providerReadiness(p,
        !!resolveCommand(p === 'github' ? 'gh' : providerCommand(p, ctx.cfg.agentCmd)), state[p], own, Date.now()));
      ctx.sendTo(c, { t: 'readiness', providers });
    }).catch(() => ctx.warn(c, 'Provider readiness could not be checked. Try again when the sign-in finishes.'));
  },
} satisfies HandlerMap<ProviderReadinessClientMsg>;
