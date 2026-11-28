import { startPitch, pitchAction } from '../../pitch/actions.js';
import { hqChanged } from '../../hq/views.js';
import { projectPitch, pitchVerdict } from '../../hq/reviews.js';
import { hqPitch } from '../../hq/views.js';
import type { PitchClientMsg } from '../../../shared/protocol/pitch.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { HandlerMap, ViewPieces } from './types.js';
export const pitchView: ViewPieces['pitch'] = (ctx, floor, c) => ctx.hq?.is(floor?.id) ? hqPitch(ctx, c) : projectPitch(ctx, c) ?? (() => { const view = ctx.cubbies?.pitchView(floor?.id, c.out ? undefined : c.accountId); return view && { ...view, readOnly: true }; })();
const last = new WeakMap<Client, string>();
export function pitchChanged(ctx: Ctx) {
  if (!ctx.cubbies) return;
  const owners = new Set([...ctx.clients.values()].filter(c => !c.out && ctx.hq?.owns(c.accountId)).map(c => c.accountId!));
  for (const owner of owners) for (const view of ctx.hq.mac?.pitchViews(owner) ?? []) {
    if (!ctx.hq.mac!.decisions.ready(owner, view.project, view.pitch)) continue;
    for (const c of ctx.clients.values()) if (!c.out && c.accountId === owner) ctx.sendTo(c, {
      t: 'pitch.ready', project: view.project, department: view.pitch.department, version: view.pitch.version,
      projectIndex: view.projectIndex, floorId: ctx.hq.floorId!,
    });
  }
  for (const c of ctx.clients.values()) {
    const view = pitchView(ctx, ctx.floorOf(c), c), key = JSON.stringify(view) ?? '';
    if (last.get(c) === key) continue;
    last.set(c, key); ctx.sendTo(c, { t: 'pitch', ...(view ? { view } : {}) });
  }
}
export const pitchHandlers = {
  'pitch.start'(ctx, c, msg) {
    try { startPitch(ctx, c, msg.project, msg.department); } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'pitch.action'(ctx, c, msg) {
    try { pitchAction(ctx, c, msg); pitchChanged(ctx); hqChanged(ctx); } catch (e) { ctx.warn(c, (e as Error).message); }
  },
  'pitch.verdict'(ctx, c, msg) {
    try {
      pitchVerdict(ctx, c, msg);
    } catch (error) { ctx.warn(c, (error as Error).message); }
  },
} satisfies HandlerMap<PitchClientMsg>;
