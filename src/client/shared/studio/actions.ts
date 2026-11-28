import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { openTalk } from '../hq/talk';
import { projectFolder, validFolder, validRepo } from '../../../shared/protocol/studio';
import './studio.css';
export function studioTalk(net: Net) {
  const project = store.drafts.here?.name;
  const lead = store.leadTalk?.leads.find(l => l.project === project && l.departmentIndex === undefined && l.mac);
  if (lead) openTalk(net, lead.id); else { net.send({ t: 'hq.leads.get' }); toast('Studio lead is connecting. Try again in a moment.'); }
}
export function studioActions(net: Net) {
  const actions = h('div.studio-actions');
  if (store.drafts.studio && store.drafts.canStart) actions.append(
    h('button.btn', { type: 'button', onclick: () => openStudio(net, 'new') }, 'New project'),
    h('button.btn', { type: 'button', onclick: () => openStudio(net, 'add') }, 'Add your project'));
  return actions;
}
/** Shared desktop/phone flow. Permission is the explicit named action, never a chat reply. */
export function openStudio(net: Net, mode: 'new' | 'open' | 'add') {
  const project = store.drafts.here?.name ?? '', title = mode === 'new' ? 'New project' : mode === 'add' ? 'Add your project' : 'Open floor';
  const input = h('input', { type: 'text', maxlength: mode === 'add' ? 201 : 60, 'aria-label': mode === 'add' ? 'Repository or folder' : mode === 'open' ? 'Project name, to confirm' : 'Project name', autocomplete: 'off', placeholder: mode === 'add' ? 'owner/repo or local folder' : mode === 'open' ? project : 'Project name' });
  const status = h('p', { role: 'status' }), submit = h('button.btn.primary', { type: 'submit' }, title);
  const form = h('form.modal.studio-form', { role: 'dialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), h('div.body', {},
    h('p', {}, mode === 'new' ? 'Your Mac starts a Studio lead and a private draft floor. Tell your lead what we’re building.' : mode === 'open' ? `Create the private GitHub repository from your Mac and open the floor to everyone. Type ${project} to confirm.` : 'Use a GitHub repository or a folder under ~/Documents/GitHub on your Mac. Adding it opens its floor to everyone.'), input, status), h('footer', {}, submit));
  let pending = '', timer: ReturnType<typeof setTimeout> | undefined;
  const valid = () => mode === 'open' ? input.value === project : mode === 'new' ? !!projectFolder(input.value.trim()) : validRepo(input.value.trim()) || validFolder(input.value.trim());
  const ready = () => { submit.disabled = !!pending || !valid(); }; input.oninput = ready; ready();
  const off = net.onMessage(m => {
    if (m.t !== 'project.result' || m.id !== pending) return;
    clearTimeout(timer); pending = ''; input.disabled = false; status.textContent = m.detail; ready();
    if (m.ok) modal.close();
  });
  const modal = openModal(form, { doing: title, onClose: () => { off(); clearTimeout(timer); } });
  form.onsubmit = e => {
    e.preventDefault(); if (pending || !valid()) return;
    pending = crypto.randomUUID(); const value = input.value.trim();
    if (mode === 'new') net.send({ t: 'studio.new', id: pending, name: value });
    else if (mode === 'open') net.send({ t: 'studio.open', id: pending, project, confirm: input.value });
    else net.send({ t: 'studio.add', id: pending, ...(validRepo(value) ? { repo: value } : { folder: value }) });
    input.disabled = true; ready(); status.textContent = 'Working on your Mac…';
    timer = setTimeout(() => { status.textContent = 'Still waiting for your Mac. Check the link before retrying.'; }, 120_000);
  };
  input.focus(); return modal;
}
