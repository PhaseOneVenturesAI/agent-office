import type { Ctx } from '../../core/context';
import { toast } from '../../ui/dom';
/** Results are owner-only; the server provides a visible destination after the Mac finishes. */
export function installStudio(ctx: Ctx, ride: (floorId: string) => void) {
  ctx.messages.on('project.result', m => { toast(m.detail); if (m.ok && m.floorId) ride(m.floorId); });
}
