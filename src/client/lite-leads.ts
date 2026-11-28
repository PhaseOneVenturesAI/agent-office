import type { Net } from './net';
import { store } from './state';
import { h } from './ui/dom';
import { leadStatus, openTalk, wireTalk } from './shared/hq/talk';
export function installLiteLeads(net: Net) {
  wireTalk(net);
  const section = h('section.lite-leads', { 'aria-label': 'Leads' });
  document.querySelector('.lite-main')!.prepend(section);
  const paint = () => {
    const view = store.leadTalk;
    section.hidden = !view;
    section.replaceChildren(...(view ? [h('h2', {}, 'Leads'), h('ul', {}, ...view.leads.map(lead => h('li', {},
      h('button.btn', { onclick: () => openTalk(net, lead.id) }, `${lead.id === 'cofounder' ? '' : lead.project + ' · '}${lead.title} · ${leadStatus(lead)}`))))] : []));
  };
  store.on('leadTalk', paint); paint();
}
