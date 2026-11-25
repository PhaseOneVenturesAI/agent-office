import './ui.css';
import { DRAFT_NAME_MAX, cleanDraftName } from '../../../shared/protocol/drafts';
import type { Net } from '../../net';
import { h, openModal } from '../../ui/dom';
import { confirmMatches } from './kickoff-model';

// Kick off: what happens, and the project's name typed again before the button wakes up. It sends
// drafts.kickoff and says "Kicking off…" until the office answers: drafts.kicked closes it (the floor
// changes in front of you), drafts.kickoffFailed shows why here and lets you try again.

/** Longer than the office takes to make the repository and open the floor. */
const ANSWER_MS = 90_000;

export interface KickoffPanel {
  readonly open: boolean;
  /** The office couldn't finish: say why, and let you try again. */
  failed(error: string): void;
  close(): void;
}

/** Opens the Kick off window for the draft `name` on floor `floorId`, with its lead called `lead`. */
export function openKickoff(net: Net, floorId: string, name: string, lead: string): KickoffPanel {
  const typed = h('input', { type: 'text', maxlength: DRAFT_NAME_MAX, placeholder: name, 'aria-label': 'Project name, to confirm', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const submit = h('button.btn.primary', { type: 'submit', disabled: true }, '🚀 Kick off') as HTMLButtonElement;
  const err = h('p.ko-err', { 'aria-live': 'polite' });
  const status = h('span.grow', { 'aria-live': 'polite' }, 'Nothing changes until you press Kick off');
  const form = h(
    'form.modal.draft-kickoff',
    { role: 'dialog', 'aria-label': `Kick off ${name}` },
    h('header', {}, h('h2', {}, `🚀 Kick off ${name}`)),
    h(
      'div.body',
      {},
      h('p', {}, 'When you kick off:'),
      h(
        'ul.ko-steps',
        {},
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '🔒'), h('span', {}, 'A private repository is made in the team’s GitHub, with the brief, the design system, the approved screens and the plan.')),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '💡'), h('span', {}, 'The floor opens to everyone: the lights come on, the desks are uncovered, and it shows in everyone’s elevator.')),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '🚪'), h('span', {}, `The cubby hall opens with your cubby, and ${lead} moves in.`)),
      ),
      h('label', {}, h('span', {}, 'Type ', h('b', {}, name), ' to confirm'), typed),
      err,
    ),
    h('footer', {}, status, submit),
  ) as HTMLFormElement;

  let sent = false;
  let timer: number | undefined;
  const ready = () => {
    submit.disabled = sent || !confirmMatches(typed.value, name);
  };
  // The game doesn't get the keys while you type (Esc still closes the window).
  typed.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  typed.addEventListener('input', () => {
    err.textContent = '';
    ready();
  });
  const again = (why: string) => {
    clearTimeout(timer);
    sent = false;
    typed.disabled = false;
    status.textContent = 'Nothing changed';
    err.textContent = why;
    ready();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sent || !confirmMatches(typed.value, name)) return;
    sent = true;
    typed.disabled = true;
    submit.disabled = true;
    err.textContent = '';
    status.textContent = 'Kicking off…';
    net.send({ t: 'drafts.kickoff', floorId, confirm: cleanDraftName(typed.value) });
    // The office went away before it answered: don't wait forever.
    timer = window.setTimeout(() => again("The office didn't answer. Nothing changed; try again."), ANSWER_MS);
  });
  let open = true;
  const modal = openModal(form, {
    doing: '🚀 kicking off a project',
    onClose: () => {
      open = false;
      clearTimeout(timer);
    },
  });
  setTimeout(() => typed.focus(), 30);
  const panel: KickoffPanel = {
    get open() {
      return open;
    },
    failed: (error) => again(error || "The kickoff couldn't finish."),
    close: () => modal.close(),
  };
  return panel;
}
