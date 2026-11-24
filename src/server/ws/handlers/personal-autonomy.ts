import type { PersonalAutonomyClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { applyPersonalAutonomy, personalAutonomyState } from '../../personal-autonomy/service.js';
import type { HandlerMap } from './types.js';

const own = (ctx: Ctx, c: Client) => !c.out && c.accountId && ctx.accounts.get(c.accountId) ? c.accountId : undefined;
export async function savePersonalAutonomy(ctx: Ctx, c: Client, msg: Extract<PersonalAutonomyClientMsg, { t: 'personal.autonomy.set' }>): Promise<void> {
  const account = own(ctx, c);
  const reply = (error?: string) => ctx.sendTo(c, { t: 'personal.autonomy.state', requestId: msg.requestId, ...(account ? { state: personalAutonomyState(ctx, account) } : {}), ...(error ? { error } : {}) });
  if (!account) return reply('Sign in with your own account to choose how your agents approve work.');
  if (typeof msg.automatic !== 'boolean' || typeof msg.requestId !== 'string' || msg.requestId.length > 100 || Object.keys(msg).some(k => !['t', 'automatic', 'requestId'].includes(k))) return reply('Only your own automatic-approval preference can be changed here.');
  if (!ctx.personalAutonomy.begin(account)) return reply('Your previous change is still waiting for the agents. Please wait for its result.');
  try {
    const error = ctx.personalAutonomy.set(account, msg.automatic); if (error) return reply(error);
    const errors = await applyPersonalAutonomy(ctx, account, msg.automatic ? 'autonomous' : 'supervised');
    reply(errors.length ? 'Preference saved. Some sessions could not confirm the change; see their status below.' : undefined);
    for (const other of ctx.clients.values()) if (other !== c && !other.out && other.accountId === account) ctx.sendTo(other, { t: 'personal.autonomy.state', state: personalAutonomyState(ctx, account) });
  } catch { reply('Preference saved, but a running session could not be updated. Its active work was kept.'); }
  finally { ctx.personalAutonomy.end(account); }
}
export const personalAutonomyHandlers = {
  'personal.autonomy.get'(ctx, c, msg) {
    const account = own(ctx, c);
    ctx.sendTo(c, { t: 'personal.autonomy.state', requestId: msg.requestId, ...(account ? { state: personalAutonomyState(ctx, account) } : { error: 'Sign in with your own account to choose how your agents approve work.' }) });
  },
  'personal.autonomy.set'(ctx, c, msg) { void savePersonalAutonomy(ctx, c, msg); },
} satisfies HandlerMap<PersonalAutonomyClientMsg>;
