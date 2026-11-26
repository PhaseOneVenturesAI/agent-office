import type { Slice } from '../store';
import { cleanPitch } from '../../../shared/pitch/clean';
import type { PitchView } from '../../../shared/protocol/pitch';
declare module '../store' {
  interface Store { pitch?: PitchView }
  interface Topics { pitch: true }
}
function clean(raw?: PitchView): PitchView | undefined {
  if (!raw || ![raw.cubbyId, raw.floorId, raw.computerId].every(v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v))) return;
  const pitch = cleanPitch(raw.pitch);
  const notice = raw.notice && typeof raw.notice.requestId === 'string' && /^[\w-]{1,128}$/.test(raw.notice.requestId) && typeof raw.notice.text === 'string'
    ? { requestId: raw.notice.requestId, text: raw.notice.text.slice(0, 1000) } : undefined;
  return pitch ? { ...(raw.displayFloorId ? { displayFloorId: raw.displayFloorId } : {}), ...(raw.readOnly === true ? { readOnly: true } : {}), ...(raw.ownerDevices ? { ownerDevices: raw.ownerDevices } : {}), ...(notice ? { notice } : {}), cubbyId: raw.cubbyId, floorId: raw.floorId, computerId: raw.computerId, pitch } : undefined;
}
export const pitch: Slice = {
  init(s) { s.pitch = undefined; },
  on: { pitch(s, m) { s.pitch = (m.view?.displayFloorId ?? m.view?.floorId) === s.floor ? clean(m.view) : undefined; return ['pitch']; } },
  enter(s, v) { s.pitch = clean(v.pitch); return ['pitch']; },
};
