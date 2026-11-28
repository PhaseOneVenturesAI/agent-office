import type { Route } from '../router.js';
import { send } from '../util.js';

export const draftImageRoute = {
  method: 'GET', prefix: '/api/drafts/', auth: 'session',
  handle(ctx, { res, path, session }) {
    const match = /^\/api\/drafts\/([^/]+)\/images\/([0-9a-f]{64})$/.exec(path);
    const owner = session.account?.id;
    const image = (match && owner ? ctx.hq?.studio?.image(match[1], owner, match[2]) : undefined) ?? (match && owner && ctx.drafts?.owns(match[1], owner) && ctx.floors.get(match[1])?.def.draft
      ? ctx.cubbies.draftImage(match[1], owner, match[2]) : undefined);
    if (!image) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': image.meta.mime, 'Content-Length': image.bytes.length,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.end(image.bytes);
  },
} satisfies Route;
