import { canViewTerminal } from '../worker-ownership.js';
import type { Floor } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorView } from '../../shared/protocol.js';
import { views } from '../ws/handlers/index.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';
import { redactWorkersFor } from '../role-access.js';

/**
 * Everything on a floor, for whoever just arrived there: each feature's piece (see
 * ws/handlers/index.ts). Role characters arrive as their public shell for everyone but their
 * owner/controllers — the initial payload is recipient-aware, not just the updates (see
 * messaging.toFloor).
 */
export const floorView = (ctx: Ctx, floor: Floor | undefined, forClient?: Client): FloorView => {
  const view: Record<string, unknown> = { floor: floor?.id ?? null };
  for (const [key, piece] of Object.entries(views)) view[key] = piece(ctx, floor);
  const assembled = view as unknown as FloorView;
  if (floor && forClient) assembled.workers = redactWorkersFor(ctx, floor, assembled.workers, forClient.accountId);
  return assembled;
};
/** The rooftop bar: nobody works up there, so it has none of a floor's things. */
export const roofView = (ctx: Ctx): FloorView => ({ ...floorView(ctx, undefined), floor: ROOF });
export const screensOf = (ctx: Ctx, c: Client, floor: Floor | undefined) => {
  for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) if (canViewTerminal(ctx, c.accountId, workerId)) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
};
