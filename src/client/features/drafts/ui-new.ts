import './ui.css';
import { store } from '../../state';
import { openStudio } from '../../shared/studio/actions';
import { DRAFT_NAME_MAX, cleanDraftName } from '../../../shared/protocol/drafts';
import type { Net } from '../../net';
import { h, openModal } from '../../ui/dom';

// New project: a name, and the office makes a draft floor of it that only you can see. Once it's made
// (drafts.made) the elevator rides you there; the trip closes this window.

/** Longer than the office takes to make a draft floor. */
const ANSWER_MS = 20_000;

/** Opens the New project window. */
export function openNewProject(net: Net) {
  if (store.drafts.studio) return openStudio(net, 'new');
  const name = h('input', { type: 'text', maxlength: DRAFT_NAME_MAX, placeholder: 'e.g. Kindly', 'aria-label': 'Project name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const submit = h('button.btn.primary', { type: 'submit' }, '✨ New project');
  const err = h('p.dn-err', { 'aria-live': 'polite' });
  const status = h('span.grow', {}, 'Lights off until kickoff');
  const form = h(
    'form.modal.draft-new',
    { role: 'dialog', 'aria-label': 'New project' },
    h('header', {}, h('h2', {}, '✨ New project')),
    h('div.body', {}, h('p', {}, 'A new floor for it, with your lead waiting at the doors. Only you can see it until kickoff.'), h('label', {}, 'Project name', name), err, h('p.dn-note', {}, `Up to ${DRAFT_NAME_MAX} characters.`)),
    h('footer', {}, status, submit),
  ) as HTMLFormElement;
  // The game doesn't get the keys while you type (Esc still closes the window).
  name.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  let sent = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const clean = cleanDraftName(name.value);
    if (!clean) {
      err.textContent = 'Give it a name first.';
      name.focus();
      return;
    }
    if (sent) return;
    sent = true;
    submit.disabled = name.disabled = true;
    err.textContent = '';
    status.textContent = `Making ${clean}…`;
    net.send({ t: 'drafts.new', name: clean });
    // The office went away before it answered: don't wait forever.
    timer = window.setTimeout(() => {
      sent = false;
      submit.disabled = name.disabled = false;
      status.textContent = 'Lights off until kickoff';
      err.textContent = "The office didn't make it. Try again.";
    }, ANSWER_MS);
  });
  let timer: number | undefined;
  openModal(form, { doing: '✨ starting a project', onClose: () => clearTimeout(timer) });
  setTimeout(() => name.focus(), 30);
}
