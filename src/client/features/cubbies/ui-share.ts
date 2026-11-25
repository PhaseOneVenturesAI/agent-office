import './ui-share.css';
import { h, openModal, type Modal } from '../../ui/dom';
import { TASK_NOTE, TASK_PROMPT_MAX, TASK_TITLE_MAX, cleanTask, knockPrompt } from './share-model';

// Sharing's two windows (cubbies step 4), both the office's cream dialog with its ✕ and Esc: the owner's
// answer to a knock, and Send a task to the floor. Everything shown is put in as text, never as HTML.

export interface AdmitPrompt {
  close(): void;
  readonly open: boolean;
}

/**
 * Someone knocked on your cubby. Let in or Not now; the ✕ and Esc are Not now. `answer` is called once,
 * whichever way it closes (not at all when `close()` takes it away because it was answered elsewhere).
 */
export function openAdmitPrompt(name: string, answer: (allow: boolean) => void): AdmitPrompt {
  let answered = false;
  const reply = (allow: boolean) => {
    if (answered) return;
    answered = true;
    answer(allow);
    modal.close();
  };
  const letIn = h('button.btn.primary', { type: 'button', onclick: () => reply(true) }, 'Let in');
  const notNow = h('button.btn', { type: 'button', onclick: () => reply(false) }, 'Not now');
  const el = h(
    'div.modal.cubby-knock',
    { role: 'alertdialog', 'aria-label': 'Someone knocked' },
    h('header', {}, h('h2', {}, '🚪 Knock knock')),
    h('div.body', {}, h('p', {}, knockPrompt(name)), h('p.cb-note', {}, 'They can see your helpers and read your lead chat. They can’t type or approve anything.')),
    h('footer', {}, notNow, letIn),
  );
  const modal = openModal(el, { doing: '🚪 answering the door', onClose: () => reply(false) });
  setTimeout(() => letIn.focus(), 30);
  return {
    close() {
      answered = true;
      modal.close();
    },
    get open() {
      return !answered;
    },
  };
}

export interface SendTaskPanel {
  /** The office has the card: closes the panel. */
  sent(): void;
  readonly open: boolean;
}

/** How long the panel waits for the office before letting you send again. */
const SEND_WAIT_MS = 8000;

/** Q in your own cubby: a task card for this floor's public Task queue, run on the office server. */
export function openSendTask(send: (title: string, prompt: string) => void): SendTaskPanel {
  const title = h('input', { type: 'text', maxlength: TASK_TITLE_MAX, placeholder: 'What needs doing', 'aria-label': 'Title' }) as HTMLInputElement;
  const prompt = h('textarea', { rows: 6, maxlength: TASK_PROMPT_MAX, placeholder: 'Tell the floor’s agents what to do…', 'aria-label': 'Prompt' }) as HTMLTextAreaElement;
  const count = h('span.cb-count');
  const go = h('button.btn.primary', { type: 'submit', disabled: true }, '📋 Send a task to the floor') as HTMLButtonElement;
  const form = h(
    'form.modal.cubby-task',
    { 'aria-label': 'Send a task to the floor' },
    h('header', {}, h('h2', {}, '📋 Send a task to the floor')),
    h(
      'div.body',
      {},
      h('label', {}, h('span', {}, 'Title'), title),
      h('label', {}, h('span', {}, 'Prompt ', count), prompt),
      h('p.cb-note.cb-task-note', {}, TASK_NOTE),
    ),
    h('footer', {}, go),
  ) as HTMLFormElement;
  let sending = false;
  let timer = 0;
  let closed = false;
  const paint = () => {
    count.textContent = prompt.value.length > TASK_PROMPT_MAX - 400 ? `${prompt.value.length}/${TASK_PROMPT_MAX}` : '';
    go.disabled = sending || !cleanTask(title.value, prompt.value);
    go.textContent = sending ? 'Sending…' : '📋 Send a task to the floor';
  };
  for (const f of [title, prompt]) {
    f.addEventListener('input', paint);
    // The game doesn't get the keys while you type (Esc still closes: the window hears it first).
    f.addEventListener('keydown', (e) => e.stopPropagation());
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const card = cleanTask(title.value, prompt.value);
    if (!card || sending) return;
    sending = true;
    send(card.title, card.prompt);
    paint();
    timer = window.setTimeout(() => {
      sending = false;
      if (!closed) paint();
    }, SEND_WAIT_MS);
  });
  const modal: Modal = openModal(form, {
    doing: '📋 sending a task to the floor',
    onClose: () => {
      closed = true;
      clearTimeout(timer);
    },
  });
  paint();
  setTimeout(() => title.focus(), 30);
  return {
    sent() {
      modal.close();
    },
    get open() {
      return !closed;
    },
  };
}
