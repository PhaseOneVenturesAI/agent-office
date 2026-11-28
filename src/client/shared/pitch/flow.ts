import { DEPARTMENTS, sameDepartment, pitchSpend } from '../../../shared/pitch/flow';
import type { PitchView } from '../../../shared/protocol/pitch';
import { pitchImageUrl } from '../../../shared/protocol/pitch';
import { store } from '../../state';
import type { Net } from '../../net';
import { h, openModal } from '../../ui/dom';
import { openTalk } from '../hq/talk';
import './flow.css';
export const pitchLeads = () => (store.leadTalk?.mine || store.leadTalk?.manager) ? store.leadTalk.leads.filter(l => l.mac && l.departmentIndex !== undefined) : [];
export function pitchProjects() {
  if (!store.leadTalk?.mine && !store.leadTalk?.manager) return [];
  if (store.hq?.floorId === store.floor) return store.hq.projects.map(p => p.name);
  return [...new Set(store.leadTalk.leads.filter(l => l.floorId === store.floor).map(l => l.project))];
}
export function flowView(project: string): PitchView | undefined {
  return store.pitch?.project === project ? store.pitch : store.hq?.pitches?.find(v => v.project === project);
}
export function pitchPanel(net: Net, initial?: string) {
  const el = h('section.pitch-flow');
  let project = initial ?? store.pitch?.project ?? pitchProjects()[0];
  const paint = () => {
    const projects = pitchProjects(), mine = !!store.leadTalk?.mine;
    if (!projects.includes(project)) project = projects[0];
    if (!project) { el.replaceChildren(); return; }
    const select = h('select', { 'aria-label': 'Pitch project', onchange: () => {
      project = select.value; const p = store.hq?.pitches?.find(p => p.project === project);
      if (p) net.send({ t: 'hq.pitch', projectIndex: p.projectIndex }); paint();
    } }, ...projects.map(p => h('option', { value: p }, p)));
    select.value = project;
    const v = flowView(project), p = v?.pitch;
    const act = (action: 'pick' | 'ok' | 'decline', id: string) => { if (mine && p && !v?.readOnly) net.send({ t: 'pitch.action', project, version: p.version, action, id }); };
    const leads = pitchLeads().filter(l => l.project === project);
    const departments = h('div.pitch-departments', {}, ...DEPARTMENTS.map(name => {
      const lead = leads.find(l => sameDepartment(l.role, name));
      return h('div', {}, h('button.btn', { disabled: !mine || !lead, onclick: () => {
        if (mine && lead) net.send({ t: 'pitch.start', project, department: lead.departmentIndex! });
      } }, name), !lead ? h('small', {}, `Ask ${project} lead to add a ${name} lead`) : null);
    }));
    const lead = p && leads.find(l => sameDepartment(l.role, p.department));
    const spend = p && pitchSpend(p);
    const brief = p?.brief;
    el.replaceChildren(h('div', {}, h('h2', {}, 'Pitch room'), select, departments,
      !mine ? h('p', {}, 'Read only · only the owner can choose or approve') : null,
      lead && mine ? h('button.btn', { onclick: () => openTalk(net, lead.id) }, 'Chat with lead') : null,
      brief ? h('article.pitch-brief', {}, h('h3', {}, brief.title), h('p', {}, `Audience: ${brief.audience}`), h('p', {}, `Goal: ${brief.goal}`), h('p', {}, `Constraints: ${brief.constraints.join(' · ')}`)) : null,
      p ? h('section', { 'aria-label': 'Directions' }, h('h3', {}, 'Directions'), ...(p.directions ?? []).map(d => h('article.pitch-direction', { 'data-pitch-card': `direction-${d.id}` },
        d.image && v ? h('img', { src: pitchImageUrl(v.cubbyId, d.image.hash), alt: d.title }) : null,
        h('h4', {}, d.title), h('p', {}, d.summary), h('button.btn', { disabled: !mine || !!v?.readOnly || !!p.picked, onclick: () => act('pick', d.id) }, p.picked === d.id ? 'Picked' : 'Pick')))) : null,
      p ? h('section.pitch-progress', { 'aria-label': 'Build progress' }, h('h3', {}, `${p.status === 'ready' ? 'Ready to pitch' : 'Build progress'} · ${p.version}`),
        h('p', {}, lead?.doing ?? ''), ...(lead?.helpers ?? []).map(w => h('p', {}, `${w.title}${w.doing ? ` · ${w.doing}` : ''}`)),
        h('p', {}, `Spent $${spend!.spent.toFixed(2)} · Reserved $${spend!.reserved.toFixed(2)} · Remaining $${spend!.remaining.toFixed(2)}`)) : null,
      p ? h('section', { 'aria-label': 'Costs' }, ...(p.costs ?? []).map(c => h('article.pitch-cost', { 'data-pitch-card': `cost-${c.id}` }, h('h3', {}, `${c.tool}: ${c.what}`),
        h('p', {}, `$${c.estimate.toFixed(2)} · ${c.status} · Remaining $${spend!.remaining.toFixed(2)}`), c.status === 'asked' ? h('div', {},
          h('button.btn', { disabled: !mine || !!v?.readOnly || !p.budget || c.estimate > spend!.remaining, onclick: () => act('ok', c.id) }, 'OK'),
          h('button.btn', { disabled: !mine || !!v?.readOnly, onclick: () => act('decline', c.id) }, 'Decline'),
          c.estimate > spend!.remaining ? h('small', {}, 'Exceeds remaining session budget') : null) : null))) : null));
  };
  const offs = ['pitch', 'hq', 'leadTalk', 'floor', 'me'].map(topic => store.on(topic as 'pitch', paint));
  paint(); return { el, close: () => offs.forEach(off => off()) };
}
export function openPitchFlow(net: Net, project?: string, target?: string) {
  const panel = pitchPanel(net, project);
  const modal = openModal(h('div.modal.pitch-flow-modal', { role: 'dialog', 'aria-label': 'Pitch room' }, h('header', {}, h('h2', {}, 'Pitch room')), h('div.body', {}, panel.el)), { onClose: panel.close });
  if (target) requestAnimationFrame(() => {
    const card = [...panel.el.querySelectorAll<HTMLElement>('[data-pitch-card]')].find(el => `pitch-${el.dataset.pitchCard}` === target);
    card?.scrollIntoView({ block: 'center' });
  });
  return modal;
}
