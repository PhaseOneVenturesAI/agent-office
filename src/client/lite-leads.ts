import type { Net } from './net';
import { store } from './state';
import { h } from './ui/dom';
import { leadStatus, openTalk, wireTalk } from './shared/hq/talk';
/** HQ lists every lead; a project floor lists only that project's leads (matched by floor, or by a draft's name). */
export function floorLeads<L extends { id: string; project: string; floorId?: string }>(leads: L[], floorId = store.floor, floors = store.floors): L[] {
  const floor = floors.find(f => f.id === floorId);
  if (!floor || floor.hq) return leads;
  return leads.filter(l => l.id !== 'cofounder' && (l.floorId === floor.id || !l.floorId && !!floor.name && l.project.toLowerCase() === floor.name.toLowerCase()));
}
export function installLiteLeads(net: Net) {
  wireTalk(net);
  const section = h('section.lite-leads', { 'aria-label': 'Leads' });
  document.querySelector('.lite-main')!.prepend(section);
  const paint = () => {
    const view = store.leadTalk, leads = view ? floorLeads(view.leads) : [];
    section.hidden = !leads.length;
    section.replaceChildren(...(leads.length ? [h('h2', {}, 'Leads'), h('ul', {}, ...leads.map(lead => h('li', {},
      h('button.btn', { onclick: () => openTalk(net, lead.id) }, `${lead.id === 'cofounder' ? '' : lead.project + ' · '}${lead.title} · ${leadStatus(lead)}`))))] : []));
  };
  store.on('leadTalk', paint); store.on('floor', paint); store.on('floors', paint); paint();
}
