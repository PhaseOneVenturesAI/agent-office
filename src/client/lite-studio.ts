import type { Net } from './net';
import { store } from './state';
import { h, toast } from './ui/dom';
import { openStudio, studioActions, studioTalk } from './shared/studio/actions';
export function installLiteStudio(net: Net) {
  const section = h('section', { 'aria-label': 'Projects' }); document.querySelector('.lite-main')!.prepend(section);
  const paint = () => {
    section.replaceChildren(studioActions(net));
    if (store.drafts.here?.studio) section.append(h('div.studio-actions', {},
      h('button.btn', { onclick: () => studioTalk(net) }, 'Talk to Studio lead'),
      h('button.btn', { onclick: () => openStudio(net, 'open'), disabled: !store.drafts.canKickoff }, 'Open floor')));
  };
  store.on('drafts', paint); store.on('me', paint); paint();
  net.onMessage(m => { if (m.t === 'project.result') { toast(m.detail); if (m.ok && m.floorId) net.send({ t: 'floor.go', floor: m.floorId }); } });
}
