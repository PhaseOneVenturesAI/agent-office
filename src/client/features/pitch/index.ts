import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { MEETING_ROOM as R } from '../../../shared/layout';
import { store } from '../../state';
import { openPitchPiece } from '../../shared/pitch/review';
import { officeFill } from '../../world/sky';
import { PitchRoom } from './world';
import { PitchScreens } from './screens';
import { RoomBulbs } from './lights';
declare module '../../world/types' {
  interface InteractKinds {
    pitchpiece: true;
  }
}
export function installPitch(ctx: Ctx, deps: { lights(): { intensity: number }[]; setMeetingNotice(text?: string): void }) {
  const room = new PitchRoom(), screens = new PitchScreens(ctx), bulbs = new RoomBulbs(ctx.office.group);
  const slides = new Map<string, number>(); let content = '', dim = 1;
  ctx.scene.add(room.group);
  const active = () => !!store.pitch && ctx.inOffice() && !ctx.upTop();
  const inside = () => {
    const p = ctx.player.pos;
    return active() && p.x > R.minX && p.x < R.maxX && p.z > R.minZ && p.z < R.maxZ && p.y >= -0.1 && p.y < R.height - 1;
  };
  const sync = () => {
    screens.stop();
    if (store.pitch) room.show(store.pitch, slides); else room.clear();
  };
  ctx.usables.add({ usable: () => active() ? room.stations.map(s => s.it) : [], pickable: () => room.group });
  ctx.interactions.define('pitchpiece', {
    reach: 4,
    hint: it => ({ k: `pitch-${it.label}`, parts: [hintTitle(room.stations.find(s => s.it === it)?.piece.title ?? 'Pitch'), key('E', 'Open / review')] }),
    use: onE(it => {
      const s = room.stations.find(s => s.it === it); if (!s || !active()) return;
      openPitchPiece({ send: m => ctx.net.send(m), slide: (id, i) => { slides.set(id, i); sync(); } }, s.piece.id, s.index);
    }),
  });
  ctx.ticks.add('world', () => {
    const next = JSON.stringify(store.pitch) ?? '';
    if (next !== content) { content = next; slides.clear(); sync(); }
    room.group.visible = active();
    const p = active() ? store.pitch?.pitch : undefined;
    deps.setMeetingNotice(p ? `${p.department} pitch · ${p.status}${p.status === 'ready' ? ' — walk the room' : ''}` : undefined);
    screens.tick(inside() && store.pitch?.pitch.status === 'ready' ? room.stations.find(s => s.piece.kind === 'video') : undefined);
  });
  ctx.ticks.add('env', ({ dt }) => {
    const want = inside() && store.pitch?.pitch.status === 'ready' ? 0.35 : 1;
    dim += (want - dim) * (1 - Math.exp(-dt * 4));
    if (Math.abs(dim - want) < 0.002) dim = want;
    // A floor/owner change restores immediately, without leaking the pitch mood to the next floor.
    if (!active()) dim = 1;
    // Draft floors already own copies of these bulbs; do not stack disposable materials.
    bulbs.set(store.drafts.here ? 1 : dim); room.group.userData.dim = dim;
    for (const light of room.lights) light.intensity = (1 - dim) * 1.3;
    if (dim < 1) { for (const light of deps.lights()) light.intensity *= dim; officeFill().multiplyScalar(dim); }
  });
}
