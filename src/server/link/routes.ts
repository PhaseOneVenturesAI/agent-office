import type { Route } from '../http/router.js';
import { clientIp, readBody, sameOrigin, send } from '../http/util.js';
/** Pair creation uses the Access identity when configured; approval always uses an owner session. */
export const linkRoutes: Route[] = [{
  path: '/api/mac-link/pair', method: 'POST', auth: 'public',
  async handle(ctx, { req, res }) {
    if (!ctx.hq?.mac || !ctx.hq.enabled) return send(res, 404, { error: 'HQ unavailable' });
    if (!ctx.auth.allowAttempt(clientIp(req, ctx.cfg.trustProxy))) return send(res, 429, { error: 'Try again later' });
    let owner: string | undefined;
    if (ctx.cloudflare) {
      const email = await ctx.cloudflare.emailOf(req);
      owner = email ? ctx.accounts.byEmail(email)?.id : undefined;
    } else {
      // An uncredentialed first-run request targets only this office's configured HQ owner.
      owner = ctx.accounts.state(new Set()).accounts.find(a => ctx.hq.owns(a.id))?.id;
    }
    if (!owner || !ctx.hq.owns(owner)) return send(res, 403, { error: 'Only the HQ owner can link a Mac' });
    try {
      const p = JSON.parse(await readBody(req, 1024));
      if (typeof p?.computerId !== 'string' || typeof p?.computerName !== 'string') throw Error('Invalid computer');
      return send(res, 200, ctx.hq.mac.pairings.create(owner, p.computerId, p.computerName));
    } catch { return send(res, 409, { error: 'Pairing unavailable. Check pending requests in HQ.' }); }
  },
}, {
  path: '/api/mac-link/poll', method: 'POST', auth: 'public',
  async handle(ctx, { req, res }) {
    try {
      const p = JSON.parse(await readBody(req, 1024));
      if (typeof p?.id !== 'string' || typeof p?.secret !== 'string') throw Error();
      const result = ctx.hq?.mac?.pairings.poll(p.id, p.secret); if (!result) throw Error();
      return send(res, 200, result);
    } catch { return send(res, 410, { error: 'Pairing expired or unavailable' }); }
  },
}, {
  path: '/api/mac-link', auth: 'session',
  async handle(ctx, { req, res, session }) {
    const owner = session.account?.id, mac = ctx.hq?.mac;
    if (!owner || !ctx.hq?.owns(owner) || !mac) return send(res, 403, { error: 'Owner only' });
    if (req.method === 'GET') return send(res, 200, { pending: mac.pairings.pending(owner), links: mac.links(owner) });
    if (req.method !== 'POST' || !sameOrigin(req, ctx.cfg) || !req.headers['content-type']?.startsWith('application/json')) return send(res, 403, { error: 'Same-origin JSON required' });
    try {
      const p = JSON.parse(await readBody(req, 1024));
      if (typeof p?.id !== 'string') throw Error();
      if (p.action === 'revoke') mac.revoke(owner, p.id);
      else if (p.action === 'approve' || p.action === 'deny') mac.pairings.decide(owner, p.id, p.action === 'approve');
      else throw Error();
      return send(res, 200, { ok: true });
    } catch { return send(res, 409, { error: 'Link or pairing unavailable' }); }
  },
}];
