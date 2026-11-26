import type { CubbyNodeFrame } from '../../shared/protocol/cubbies.js';

type Snapshot = Extract<CubbyNodeFrame, { t: 'cubby.snapshot' }>;
export const BOARD_TOO_BIG = 'The board is too big to show; it is still saved on your computer';
const fits = (frame: Snapshot) => Buffer.byteLength(JSON.stringify(frame)) <= 64 * 1024;

/** Never truncate board feedback. Publish a fresh roster and a visible error if it cannot fit. */
export function publication(frame: Snapshot): Snapshot {
  if (fits(frame)) return frame;
  const small: Snapshot = { t: 'cubby.snapshot', floorId: frame.floorId, observedAt: frame.observedAt,
    projects: frame.projects, agents: [...frame.agents], plan: [], needsYou: [], error: BOARD_TOO_BIG };
  // Roster metadata alone can also exceed the socket cap; retain as many current agents as fit.
  while (!fits(small) && small.agents.length) small.agents.pop();
  return small;
}
