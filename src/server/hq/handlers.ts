import { choosePitch } from './pitch.js';
import type { HandlerMap } from '../ws/handlers/types.js';
import type { HQClientMsg } from '../../shared/protocol/hq.js';
import { sendManagerMessage, declineManagerMessage } from './messages.js';
export const hqHandlers = {
  'hq.pitch'(ctx, c, msg) {
    try { choosePitch(ctx, c, msg.projectIndex); } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'hq.message'(ctx, c, msg) {
    try { sendManagerMessage(ctx, c, msg.lead, msg.text); } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'hq.decline'(ctx, c, msg) {
    try { declineManagerMessage(ctx, c, msg.id); } catch (e) { ctx.warn(c, (e as Error).message); }
  },
} satisfies HandlerMap<Exclude<HQClientMsg, { t: 'cubbies.chat' } | import('../../shared/protocol/hq.js').HQTalkClientMsg>>;
