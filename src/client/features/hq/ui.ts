import './ui.css';
import { projectElement } from '../../shared/hq/needs';
import { departmentLabel } from './labels';
import type { HQView } from '../../../shared/protocol/hq';
import { h, openModal } from '../../ui/dom';
/** The same factual board text in a readable window for touch and narrow screens. */
export function openHQBoard(view: HQView, project?: string, onPitch?: (projectIndex: number, pieceId: string) => void, onTalk?: (id: string) => void, actions?: () => HTMLElement) {
  const projects = project ? view.projects.filter(p => p.name === project) : view.projects;
  const body = h('div.body');
  if (view.mine && !project && actions) body.append(actions());
  for (const p of projects) {
    const section = h('section', {}, h('h3', {}, p.name));
    if (p.hasMainLead) section.append(h('p', {}, 'CEO'));
    for (const d of p.departmentLeads) section.append(h('p', {}, departmentLabel(d)));
    for (const lead of view.leads?.filter(l => l.mac && l.project === p.name) ?? []) if (onTalk) section.append(h('button.btn', { onclick: () => onTalk(lead.id) }, `Talk to ${lead.title}`));
    section.append(h('h4', {}, `${p.name} tasks`), projectElement(p));
    const pitch = view.pitches?.find(q => q.project === p.name);
    if (pitch && onPitch) {
      for (const lead of view.leads?.filter(l => l.mac && l.project === p.name) ?? []) if (onTalk) section.append(h('button.btn', { onclick: () => onTalk(lead.id) }, `Talk to ${lead.title}`));
    section.append(h('h4', {}, `${p.name} pitch · ${pitch.pitch.status}`));
      for (const piece of pitch.pitch.pieces) section.append(h('button.btn', { onclick: () => onPitch(pitch.projectIndex, piece.id) }, piece.title));
    }
    body.append(section);
  }
  openModal(h('div.modal.hq-board', { role: 'dialog', 'aria-label': project ? `${project} tasks` : 'HQ portfolio' },
    h('header', {}, h('h2', {}, project ? `${project} tasks` : `${view.ownerName}’s portfolio`)), body));
}
