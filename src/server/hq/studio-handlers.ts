import type { StudioClientMsg } from '../../shared/protocol/studio.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import type { Ctx } from '../office/context.js';
import type { Client } from '../office/client.js';
function handle(ctx: Ctx, c: Client, msg: StudioClientMsg) {
  try { if (!ctx.hq?.studio) throw Error('Studio unavailable'); ctx.hq.studio.submit(c, msg); }
  catch (e) {
    if ('id' in msg && typeof msg.id === 'string') ctx.sendTo(c, { t: 'project.result', id: msg.id, ok: false, detail: (e as Error).message });
    else ctx.warn(c, (e as Error).message);
  }
}
export const studioHandlers = { 'studio.new': handle, 'studio.open': handle, 'studio.add': handle, 'studio.feedback': handle } satisfies HandlerMap<StudioClientMsg>;
