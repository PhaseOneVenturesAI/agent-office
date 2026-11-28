import type { HQLead, HQNeeds, HQProject } from '../../../shared/protocol/hq';
import { needsLabel } from '../../../shared/protocol/hq';
import { h } from '../../ui/dom';
export function needsElement(needs?: HQNeeds, raised = false) {
  const el = h('section.hq-needs', { 'aria-label': 'Needs you' });
  if (needs || raised) {
    el.append(h('p', {}, `${raised || (needs?.open ?? 0) > 0 ? '✋ ' : ''}${needs ? needsLabel(needs) : 'Needs you'}`));
    if (needs?.stale) el.style.opacity = '.65';
    for (const line of needs?.items ?? []) el.append(h('p', {}, line));
  }
  return el;
}
export function projectElement(p: HQProject) {
  const section = h('section', {}, h('h3', {}, p.name), needsElement(p.needs));
  const workers = p.workers ?? [];
  for (const w of workers.slice(0, 5)) section.append(h('p', {}, `${w.title} · ${w.doing ?? `${w.provider} · ${w.branch || '—'}`}`));
  if (workers.length > 5) section.append(h('p', {}, `+${workers.length - 5} more`));
  if (!workers.length) section.append(h('p', {}, 'No live workers'));
  return section;
}
export const leadNeeds = (lead?: HQLead) => needsElement(lead?.needs, lead?.needsYou);
