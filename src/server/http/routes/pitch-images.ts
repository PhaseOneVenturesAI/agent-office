import type { Route } from '../router.js';
import { hqImage } from '../../hq/views.js';
import { send } from '../util.js';
export const pitchImageRoute = {
  method: 'GET', prefix: '/api/pitch/', auth: 'session',
  handle(ctx, { res, path, session }) {
    const match = /^\/api\/pitch\/([\w-]{1,128})\/images\/([0-9a-f]{64})$/.exec(path);
    const image = match && session.account && (ctx.cubbies.pitchImage(match[1], session.account.id, match[2]) || hqImage(ctx, session.account.id, match[1], match[2]));
    if (!image) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': image.meta.mime, 'Content-Length': image.bytes.length,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    res.end(image.bytes);
  },
} satisfies Route;
