import type { HQLead } from '../../../shared/protocol/hq';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { leadNeeds } from '../../shared/hq/needs';
import { openTalk } from '../../shared/hq/talk';
import { selectMacPitch } from './mac-lead';
/** Keep existing needs and published pitch access alongside linked chat. */
export function openLinkedTalk(ctx: Ctx, lead: HQLead, current: () => HQLead | undefined) {
  const el = h('section.talk-details');
  const paint = () => {
    el.replaceChildren(leadNeeds(current()));
    if (store.floor !== store.hq?.floorId) return;
    const pitch = store.hq?.pitches?.find(p => p.projectIndex === lead.projectIndex);
    if (pitch) for (const p of pitch.pitch.pieces) el.append(h('button.btn', { onclick: () => selectMacPitch(ctx, lead.projectIndex, p.id) }, p.title));
  };
  const a = store.on('leadTalk', paint), b = store.on('hq', paint); paint();
  return openTalk(ctx.net, lead.id, { el, close: () => { a(); b(); } });
}
