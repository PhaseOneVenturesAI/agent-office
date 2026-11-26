import './ui.css';
import type { HQView } from '../../../shared/protocol/hq';
import { h, openModal } from '../../ui/dom';
/** The same factual board text in a readable window for touch and narrow screens. */
export function openHQBoard(view: HQView, project?: string) {
  const projects = project ? view.projects.filter(p => p.name === project) : view.projects;
  const body = h('div.body');
  for (const p of projects) {
    const section = h('section', {}, h('h3', {}, p.name));
    if (p.hasMainLead) section.append(h('p', {}, 'CEO · Main lead'));
    for (const d of p.departmentLeads) section.append(h('p', {}, `${d.department} · ${d.title}`));
    section.append(h('h4', {}, `${p.name} tasks`), h('p', {}, 'Tasks appear here when the live loop is on'));
    body.append(section);
  }
  openModal(h('div.modal.hq-board', { role: 'dialog', 'aria-label': project ? `${project} tasks` : 'HQ portfolio' },
    h('header', {}, h('h2', {}, project ? `${project} tasks` : `${view.ownerName}’s portfolio`)), body));
}
