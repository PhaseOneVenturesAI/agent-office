import './ui.css';
import type { CubbyAgent, CubbyInfo } from '../../../shared/protocol/cubbies';
import { h, openModal } from '../../ui/dom';
import { STATUS_TEXT, ROLE_LABEL, clip, deadlineText, agentCard } from './model';

// Your cubby's windows: talking to its lead, and one helper's card. Both are the office's cream dialog
// with its ✕ and Esc; everything shown is put in as text, never as HTML.

export interface CubbyWindows {
  /** Your cubby with this id, as the store has it now (only yours has an inside). */
  cubby(id: string): CubbyInfo | undefined;
  /** Hears the store's cubbies change; returns how to stop. */
  onChange(fn: () => void): () => void;
  /** Sends one chat line to the lead. */
  sendChat(id: string, text: string): void;
}

const MAX_CHAT = 4000;

/**
 * Talking to your lead: the same conversation as that lead's on your computer. Only your own words go
 * to it, as chat; nothing here runs a tool or answers an approval. With the computer asleep there's
 * nobody to hear it, so the box is shut until it wakes.
 */
export function openLeadChat(w: CubbyWindows, cubbyId: string) {
  const log = h('div.cb-log', { role: 'log', 'aria-live': 'polite' });
  const side = h('aside.cb-side');
  const sub = h('span.cb-sub');
  const title = h('h2');
  const text = h('textarea', { rows: 2, maxlength: MAX_CHAT, 'aria-label': 'Message to your lead' }) as HTMLTextAreaElement;
  const send = h('button.btn.primary', { type: 'submit' }, 'Send');
  const note = h('p.cb-note');
  const form = h('form.cb-send', {}, text, send) as HTMLFormElement;
  const el = h('div.modal.cubby-chat', { role: 'dialog', 'aria-label': 'Talk to your lead' }, h('header', {}, title, sub), h('div.cb-body', {}, h('div.cb-main', {}, log, note, form), side));

  let lines = '';
  const paint = () => {
    const c = w.cubby(cubbyId);
    const it = c?.mine ? c.interior : undefined;
    if (!c || !it) {
      title.textContent = '💬 Your lead';
      sub.textContent = '';
      note.textContent = 'This cubby is gone from the floor.';
      text.disabled = send.disabled = true;
      return;
    }
    const lead = clip(it.leadName, 24) || 'Lead';
    title.textContent = `💬 ${lead}`;
    sub.textContent = `Runs on ${clip(it.computerName, 32)}`;
    const asleep = c.lamp === 'asleep';
    text.disabled = send.disabled = asleep;
    text.placeholder = asleep ? '' : `Message ${lead}…`;
    note.textContent = asleep ? `💤 ${clip(it.computerName, 32)} is asleep. ${lead} can't hear you until it wakes.` : 'Chat only: tools, commands and approvals stay on your computer.';
    note.classList.toggle('asleep', asleep);
    const key = it.chat.map((l) => `${l.id}:${l.text.length}`).join('|');
    if (key !== lines) {
      lines = key;
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.replaceChildren(
        ...(it.chat.length ? [] : [h('p.cb-empty', {}, `Say hello to ${lead}.`)]),
        ...it.chat.map((l) => h(`div.cb-line.${l.role}`, {}, h('b', {}, l.role === 'user' ? 'You' : l.role === 'assistant' ? lead : 'Note'), h('span', {}, l.text))),
      );
      if (atEnd) log.scrollTop = log.scrollHeight;
    }
    side.replaceChildren(
      h('h3', {}, 'Plan'),
      it.plan.length ? h('ol', {}, ...it.plan.map((p) => h('li', {}, p))) : h('p.cb-empty', {}, 'No plan yet'),
      h('h3', {}, 'Needs you'),
      it.needsYou.length ? h('ul.cb-needs', {}, ...it.needsYou.map((p) => h('li', {}, p))) : h('p.cb-empty', {}, 'Nothing right now'),
      h('h3', {}, `Helpers · ${it.agents.length}`),
      it.agents.length
        ? h('ul.cb-roster', {}, ...it.agents.map((a) => h('li', {}, h('button.btn.small', { type: 'button', onclick: () => openAgentCard(w, cubbyId, a.id) }, `${clip(a.tool, 14)} · ${ROLE_LABEL[a.role]}`), h('span', {}, STATUS_TEXT[a.status]))))
        : h('p.cb-empty', {}, 'Nobody else working'),
    );
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = text.value.trim();
    const c = w.cubby(cubbyId);
    if (!body || !c?.interior || c.lamp === 'asleep') return;
    w.sendChat(cubbyId, body.slice(0, MAX_CHAT));
    text.value = '';
  });
  // Enter sends, Shift+Enter is a new line; the game doesn't get the keys while you type.
  text.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const off = w.onChange(paint);
  paint();
  const c = w.cubby(cubbyId);
  openModal(el, { doing: '💬 talking to their lead', onClose: off });
  log.scrollTop = log.scrollHeight;
  if (c?.lamp !== 'asleep') setTimeout(() => text.focus(), 30);
}

/** A label and its value, as text; none for an empty value. */
function rows(...pairs: [string, string][]): HTMLElement[] {
  return pairs.filter(([, v]) => v).map(([label, value]) => h('div.cb-row', {}, h('span', {}, label), h('b', {}, value)));
}

/** One helper's card: its task and progress, or for a session you opened yourself, only its tool, branch and state. */
export function openAgentCard(w: CubbyWindows, cubbyId: string, agentId: string) {
  const title = h('h2');
  const body = h('div.body.cb-agent');
  const el = h('div.modal.cubby-agent', { role: 'dialog', 'aria-label': 'Helper' }, h('header', {}, title), body);
  const find = (): CubbyAgent | undefined => w.cubby(cubbyId)?.interior?.agents.find((a) => a.id === agentId);
  const paint = () => {
    const a = find();
    const c = w.cubby(cubbyId);
    if (!a || !c) {
      title.textContent = 'Helper';
      body.replaceChildren(h('p.cb-empty', {}, 'This helper has finished and left.'));
      return;
    }
    const asleep = c.lamp === 'asleep';
    const card = agentCard(a);
    title.textContent = card.name;
    const state = asleep ? '💤 asleep' : STATUS_TEXT[a.status];
    if (a.role === 'direct') {
      body.replaceChildren(
        ...rows(['Tool', a.tool], ['Branch', a.branch || '—'], ['State', asleep ? '💤 asleep' : a.status === 'working' ? 'busy' : STATUS_TEXT[a.status]]),
        h('p.cb-note', {}, `You opened this session yourself, so its conversation stays in ${a.tool}.`),
      );
      return;
    }
    body.replaceChildren(
      ...rows(
        ['Role', ROLE_LABEL[a.role]],
        ['Tool', a.tool],
        ['Task', a.task],
        ['Progress', a.progress ?? ''],
        ['Branch', a.branch],
        ['State', state],
        ['Deadline', a.role === 'factory' ? deadlineText(a.deadlineAt, Date.now()) : ''],
      ),
    );
  };
  const off = w.onChange(paint);
  const timer = setInterval(paint, 30_000);
  paint();
  openModal(el, {
    doing: '👀 checking on a helper',
    onClose: () => {
      off();
      clearInterval(timer);
    },
  });
}
