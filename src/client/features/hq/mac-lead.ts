import type { HQLead } from '../../../shared/protocol/hq';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { openPitchPiece } from '../../shared/pitch/review';
/** Snapshot-only leads: manager notes stay held for the owner; no command reaches the Mac. */
export function macLeadDetails(ctx: Ctx, lead: HQLead, current: () => HQLead | undefined) {
  const el = h('section.hq-messages'), account = store.me.account?.name, floor = store.floor;
  const valid = () => store.me.account?.name === account && store.floor === floor && !!store.hq && store.hq.floorId === floor;
  let draft = '';
  const paint = () => {
    if (!valid()) { el.replaceChildren(); return; }
    const l = current();
    el.replaceChildren(...(l?.messages ?? []).map(m => h('article.hq-message', {}, h('b', {}, m.manager), h('small', {}, m.state), h('p', {}, m.text),
      ...(store.hq?.mine && m.state === 'waiting' ? [h('button.btn.small', { onclick: () => ctx.net.send({ t: 'hq.decline', id: m.id }) }, 'Decline')] : []))));
    if (!store.hq?.mine) {
      const text = h('textarea', { maxlength: 4000, rows: 3, 'aria-label': 'Message for the owner' }) as HTMLTextAreaElement;
      text.value = draft; text.oninput = () => { draft = text.value; };
      const send = h('button.btn', { onclick: () => { if (valid() && text.value.trim()) { ctx.net.send({ t: 'hq.message', lead: lead.id, text: text.value.trim() }); draft = text.value = ''; } } }, 'Send to owner');
      el.append(h('p', {}, 'Held for the owner. Nothing is sent to the lead.'), text, send);
    }
    const pitch = store.hq?.pitches?.find(p => p.projectIndex === lead.projectIndex);
    if (pitch) {
      el.append(h('p', {}, `${pitch.project} · ${pitch.pitch.status} pitch`));
      for (const p of pitch.pitch.pieces) el.append(h('button.btn', { onclick: () => { if (valid()) selectMacPitch(ctx, lead.projectIndex, p.id); } }, p.title));
    }
  };
  paint(); const off = store.on('hq', paint);
  return { el, close: off };
}

/** Every project, including portfolio overflow, can select its own published pitch. */
export function selectMacPitch(ctx: Ctx, projectIndex: number, pieceId: string) {
  const pitch = store.hq?.pitches?.find(p => p.projectIndex === projectIndex);
  const floor = store.floor, account = store.me.account?.name;
  if (!pitch || store.hq?.floorId !== floor) return;
  const off = ctx.messages.on('pitch', m => {
    if (m.view?.cubbyId !== pitch.cubbyId || store.floor !== floor || store.me.account?.name !== account) return;
    off(); openPitchPiece({ send: m => ctx.net.send(m) }, pieceId);
  });
  setTimeout(off, 5000); ctx.net.send({ t: 'hq.pitch', projectIndex });
}
