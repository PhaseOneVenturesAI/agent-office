// The YouTube video on the office TV on every floor.
import type { Floor } from '../../floor.js';
import type { TvClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const tvView: ViewPieces['tv'] = (_ctx, floor) => floor?.tv.state() ?? { video: null };
const tvChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'tv', state: floor.tv.state() });

export const tvHandlers = {
  'tv.play'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.tv.play(msg.url, c.peer.name);
    if ('error' in r) return ctx.warn(c, r.error);
    tvChanged(ctx, floor);
    ctx.toastFloor(floor, `📺 ${c.peer.name} put a YouTube video on the TV`);
  },
  'tv.stop'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor || !floor.tv.stop()) return;
    tvChanged(ctx, floor);
    ctx.toastFloor(floor, `📺 ${c.peer.name} turned the TV's video off`);
  },
} satisfies HandlerMap<TvClientMsg>;
