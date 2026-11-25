// Draft floors (cubbies step 2). Placeholder wiring until the drafts module lands: off for everyone.
import type { DraftsClientMsg } from '../../../shared/protocol/drafts.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const draftsView: ViewPieces['drafts'] = () => ({ enabled: false, canStart: false });
export const draftsHandlers = {
  'drafts.new'(ctx, c) { ctx.warn(c, 'Draft floors are not switched on in this office'); },
} satisfies HandlerMap<DraftsClientMsg>;
