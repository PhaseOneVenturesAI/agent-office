import { leadNeeds } from '../../shared/hq/needs';
import { leadMessages } from './messages';
import type { HQLead } from '../../../shared/protocol/hq';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { openLeadChat } from '../../shared/cubby/chat';

export function openHQLead(ctx: Ctx, lead: HQLead, current: () => HQLead | undefined, visit?: () => void) {
  if (!lead.cubby?.interior) {
    const body = h('div.body', {}, leadNeeds(lead), h('p', {}, `Talk to ${lead.title} in the Claude app on ${lead.computer}`));
    if (visit) body.append(h('button.btn.hq-go', { onclick: visit }, 'Go there'));
    return openModal(h('div.modal.hq-lead-card', { role: 'dialog', 'aria-label': lead.title }, h('header', {}, h('h2', {}, `${lead.project} · ${lead.title}`)), body));
  }
  const messages = leadMessages(ctx, current), el = h('div');
  const extension = { ...messages, el, paint: (...args: Parameters<typeof messages.paint>) => {
    messages.paint(...args); el.replaceChildren(leadNeeds(current()), messages.el);
  } };
  return openLeadChat({
    extension,
    cubby: id => { const cubby = current()?.cubby; return cubby?.id === id ? cubby : undefined; },
    sourceFloor: () => current()?.floorId,
    onChange: fn => { const a = store.on('hq', fn), b = store.on('cubbies', fn); return () => { a(); b(); }; },
    sendChat: (id, message) => ctx.net.send({ t: 'cubbies.chat', id, ...message }),
    ...(visit ? { visit: { label: 'Go there', go: visit } } : {}),
  }, lead.cubby.id);
}
