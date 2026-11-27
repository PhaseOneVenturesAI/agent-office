import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { projectElement, leadNeeds } from './needs';
/** The same server-filtered HQ observations, with no 3D imports or notifications. */
export function installLiteHQ() {
  const anchor = document.getElementById('btn-cubby');
  if (!anchor) return;
  const button = h('button.btn', { type: 'button', id: 'btn-hq' }, 'HQ'); anchor.after(button);
  const leads = () => store.hq?.leads ?? store.cubbies.cubbies.flatMap(c => c.hqLead ? [c.hqLead.lead] : []);
  const render = () => {
    button.classList.toggle('hidden', !store.hq && !leads().length);
    const count = leads().reduce((n, l) => n + (l.needs?.open ?? (l.needsYou ? 1 : 0)), 0);
    button.textContent = `${store.hq ? 'HQ' : 'HQ · My cubby'}${count ? ` · ✋ ${count} need you` : ''}`;
  };
  button.addEventListener('click', () => {
    const body = h('div.body');
    const paint = () => {
      body.replaceChildren(...(store.hq ? store.hq.projects.map(projectElement) : leads().map(l => h('section', {}, h('h3', {}, l.project), leadNeeds(l)))));
    };
    const off = [store.on('hq', paint), store.on('cubbies', paint), store.on('floor', paint)]; paint();
    openModal(h('div.modal', { role: 'dialog', 'aria-label': 'HQ live' }, h('header', {}, h('h2', {}, 'HQ')), body), { onClose: () => off.forEach(f => f()) });
  });
  store.on('hq', render); store.on('cubbies', render); store.on('floor', render); render();
}
