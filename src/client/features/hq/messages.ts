import type { HQLead, HQMessage } from '../../../shared/protocol/hq';
import { HQ_MESSAGE_CAP, managerMessageText } from '../../../shared/protocol/hq';
import type { CubbyWindows } from '../../shared/cubby/chat';
import type { CubbyInfo } from '../../../shared/protocol/cubbies';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h } from '../../ui/dom';
import './messages.css';

export function leadMessageBadge(lead: HQLead) {
  if (lead.messageBadge) return lead.messageBadge;
  const waiting = lead.messages?.filter(i => i.state === 'waiting') ?? [];
  return waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'message' : 'messages'} from ${[...new Set(waiting.map(i => i.manager))].join(', ')}` : undefined;
}
/** A slot in the shared chat; HQ owns its composer, moderation and attribution. */
export function leadMessages(ctx: Ctx, current: () => HQLead | undefined): NonNullable<CubbyWindows['extension']> {
  const el = h('section.hq-messages', { 'aria-label': 'Manager messages', 'aria-live': 'polite' });
  const account = store.me.account?.name, floor = store.floor;
  let cubby: CubbyInfo | undefined, busy = false, closed = false, error = '';
  const onHQ = () => !closed && store.me.account?.name === account && store.floor === floor && store.hq?.floorId === floor;
  const paint = (c = cubby) => {
    cubby = c;
    el.closest('.cubby-chat')?.classList.toggle('hq-manager-chat', onHQ());
    if (!onHQ() || !c?.interior) { el.replaceChildren(); return; }
    const items = current()?.messages ?? [];
    el.replaceChildren(...items.map(item => h('article.hq-message', { 'data-id': item.id },
      h('b', {}, item.manager), h('small', {}, item.state === 'passed' ? 'passed on' : item.state), h('p', {}, item.text),
      ...(c.mine && item.state === 'waiting' ? [h('div.hq-message-actions', {},
        h('button.btn.small.primary', { type: 'button', disabled: busy, onclick: () => void pass(item) }, 'Pass on'),
        h('button.btn.small', { type: 'button', disabled: busy, onclick: () => { if (onHQ()) ctx.net.send({ t: 'hq.decline', id: item.id }); } }, 'Decline'))] : []))),
      ...(error ? [h('p.cb-note', { role: 'alert' }, error)] : []));
  };
  const pass = (item: HQMessage) => {
    if (onHQ() && store.hq?.mine && item.state === 'waiting') ctx.net.send({ t: 'hq.pass', id: item.id });
  };
  return {
    el, paint, close: () => { closed = true; },
    label: line => current()?.messages?.find(i => i.state === 'passed' && i.id === line.id && line.role === 'user' && line.text === managerMessageText(i))?.manager ?? (line.role === 'user' ? /^Message from (.+) \(HQ manager; can't approve merges, publishes or spending\): /.exec(line.text)?.[1] : undefined),
    compose: {
      allowed: () => onHQ() && !store.hq?.mine,
      note: c => `Goes to ${c.ownerName} first. ${c.interior?.leadName || 'Lead'} only sees it if ${c.ownerName} passes it on.`,
      maxLength: HQ_MESSAGE_CAP,
      send: text => { const lead = current(); if (onHQ() && !store.hq?.mine && lead?.cubby?.interior) ctx.net.send({ t: 'hq.message', lead: lead.id, text }); },
    },
  };
}
