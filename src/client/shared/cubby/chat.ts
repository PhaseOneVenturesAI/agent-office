import './chat.css';
import type { CubbyChatLine, CubbyAgent, CubbyInfo } from '../../../shared/protocol/cubbies';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { STATUS_TEXT, ROLE_LABEL, clip, deadlineText, agentCard, helperName } from './text';

// A cubby's windows: legacy read-only history, and one helper's card. Both are the office's cream dialog
// with its ✕ and Esc; everything shown is put in as text, never as HTML. The 3D office opens them from
// inside the cubby, the phone (/lite) from My cubby. Someone the owner let in to watch gets the same
// windows read-only: the lines, never a box to type in.

export interface CubbyWindows {
  /** Optional feature-owned UI, composed without changing ordinary cubby access. */
  extension?: {
    el: HTMLElement;
    paint(c: CubbyInfo | undefined): void;
    close(): void;
    label?(line: CubbyChatLine): string | undefined;
    compose?: { allowed(): boolean; note(c: CubbyInfo): string; maxLength: number; send(text: string): void };
  };
  sourceFloor?(id: string): string | undefined;
  visit?: { label: string; go(): void };
  /** Your cubby, or a room whose owner admitted this connection. */
  cubby(id: string): CubbyInfo | undefined;
  /** Hears the store's cubbies change; returns how to stop. */
  onChange(fn: () => void): () => void;
  /** The owner sends a watcher out (cubbies.admit allow false). */
  sendOut?(id: string, accountId: string): void;

}

/** What a cubby's chat shows you: yours to talk in, someone else's you're watching, or nothing (gone). */
export function chatMode(c: CubbyInfo | undefined): 'owner' | 'watching' | null {
  if (!c?.interior) return null;
  return c.mine ? 'owner' : c.watching ? 'watching' : null;
}

/** The note a watcher reads where the message box would be. */
export function watchingNote(ownerName: string, leadName: string): string {
  return `Watching: only ${clip(ownerName, 24) || 'the owner'} can talk to ${clip(leadName, 24) || 'their lead'}`;
}

/** A helper's line on the phone and in the chat's roster: tool · role · task · status. */
export function helperLine(a: CubbyAgent, asleep: boolean): string {
  const state = asleep ? '💤 asleep' : a.role === 'direct' && a.status === 'working' ? 'busy' : STATUS_TEXT[a.status];
  const task = a.role === 'direct' ? (a.branch ? `🌿 ${clip(a.branch, 32)}` : '') : clip(a.task, 48);
  return [helperName(a), task, state].filter(Boolean).join(' · ');
}

const MAX_CHAT = 4000;

/**
 * Legacy history stays read-only. The optional HQ extension supplies the manager's held-message
 * composer; linked owner conversations use the native talk UI.
 */
export function openLeadChat(w: CubbyWindows, cubbyId: string): { close(): void } {
  const log = h('div.cb-log', { role: 'log', 'aria-live': 'polite' });
  const side = h('aside.cb-side');
  const sub = h('span.cb-sub');
  const title = h('h2');
  const text = h('textarea', { rows: 2, maxlength: MAX_CHAT, 'aria-label': 'Message to your lead' }) as HTMLTextAreaElement;
  const send = h('button.btn.primary', { type: 'submit' }, 'Send');
  const note = h('p.cb-note');
  const form = h('form.cb-send', {}, text, send) as HTMLFormElement;
  const el = h('div.modal.cubby-chat', { role: 'dialog', 'aria-label': 'Talk to your lead' }, h('header', {}, title, sub), h('div.cb-body', {}, h('div.cb-main', {}, log, note, form), side));

  if (w.extension) log.after(w.extension.el);
  if (w.visit) el.querySelector('header')!.append(h('button.btn.hq-go', { type: 'button', onclick: () => w.visit!.go() }, w.visit.label));
  const account = store.me.account?.name;
  let closed = false;
  const keyNote = h('p.cb-note', { 'aria-live': 'polite' });
  note.after(keyNote);
  let lines = '';
  let wasWatching = false;
  const paint = () => {
    const c = w.cubby(cubbyId);
    const mode = chatMode(c);
    w.extension?.paint(c);
    const it = mode ? c!.interior : undefined;
    if (!c || !it) {
      title.textContent = '💬 Your lead';
      sub.textContent = '';
      note.textContent = wasWatching ? 'You’re not watching this cubby any more.' : 'This cubby is gone from the floor.';
      note.style.display = '';
      form.style.display = 'none';
      keyNote.textContent = '';
      text.disabled = send.disabled = true;
      return;
    }
    const lead = clip(it.leadName, 24) || 'Lead';
    title.textContent = `💬 ${lead}`;
    sub.textContent = `Runs on ${clip(it.computerName, 32)}`;
    const asleep = c.lamp === 'asleep';
    el.classList.toggle('watching', mode === 'watching');
    wasWatching = mode === 'watching';
    if (mode === 'watching') {
      // Watch and listen only: no box, no send, no key.
      title.textContent = `👀 ${lead}`;
      sub.textContent = `${clip(c.ownerName, 24)}'s cubby`;
      text.disabled = send.disabled = true;
      form.style.display = 'none';
      keyNote.textContent = '';
      note.style.display = '';
      note.textContent = watchingNote(c.ownerName, it.leadName);
      note.classList.remove('asleep');
      note.classList.add('watch');
    } else {
      note.classList.remove('watch');
      text.disabled = send.disabled = true;
      form.style.display = 'none';
      note.style.display = '';
      keyNote.textContent = '';
      note.textContent = 'This is a saved cubby conversation. Talk to your lead through the Mac link.';

    }
    const composer = w.extension?.compose;
    if (mode === 'watching' && composer?.allowed()) {
      form.style.display = ''; text.disabled = send.disabled = false;
      text.maxLength = composer.maxLength; text.placeholder = `Message ${lead}…`;
      note.textContent = composer.note(c);
    }
    const key = it.chat.map((l) => `${l.id}:${l.text.length}:${w.extension?.label?.(l) ?? ""}`).join('|');
    if (key !== lines) {
      lines = key;
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.replaceChildren(
        ...(it.chat.length ? [] : [h('p.cb-empty', {}, mode === 'owner' ? `Say hello to ${lead}.` : `Nothing said yet.`)]),
        ...it.chat.map((l) => h(`div.cb-line.${l.role}`, {}, h('b', {}, w.extension?.label?.(l) ?? (l.role === 'user' ? (mode === 'owner' ? 'You' : clip(c.ownerName, 24)) : l.role === 'assistant' ? lead : 'Note')), h('span', {}, l.text))),
      );
      if (atEnd) log.scrollTop = log.scrollHeight;
    }
    // The lead is who you're talking to, not one of its own helpers.
    const helpers = it.agents.filter((a) => a.role !== 'lead');
    const watchers = mode === 'owner' ? c.watchers ?? [] : [];
    side.replaceChildren(
      ...(watchers.length
        ? [
            h('h3', {}, `Watching · ${watchers.length}`),
            h('ul.cb-watchers', {}, ...watchers.map((p) => h('li', {}, h('span', {}, `👀 ${clip(p.name, 24)}`),
              w.sendOut ? h('button.btn.small.cb-out', { type: 'button', title: `Send ${clip(p.name, 24)} out`, 'aria-label': `Send ${clip(p.name, 24)} out`, onclick: () => w.sendOut!(cubbyId, p.accountId) }, '✕') : null))),
          ]
        : []),
      h('h3', {}, 'Plan'),
      it.plan.length ? h('ol', {}, ...it.plan.map((p) => h('li', {}, p))) : h('p.cb-empty', {}, 'No plan yet'),
      h('h3', {}, 'Needs you'),
      it.needsYou.length ? h('ul.cb-needs', {}, ...it.needsYou.map((p) => h('li', {}, p))) : h('p.cb-empty', {}, 'Nothing right now'),
      h('h3', {}, `Helpers · ${helpers.length}`),
      helpers.length
        ? h('ul.cb-roster', {}, ...helpers.map((a) => h('li', {}, h('button.btn.small', { type: 'button', title: helperLine(a, asleep), onclick: () => openAgentCard(w, cubbyId, a.id) }, helperName(a)), h('span', {}, asleep ? '💤' : STATUS_TEXT[a.status]), a.role === 'direct' || !a.task ? null : h('small', {}, clip(a.task, 60)))))
        : h('p.cb-empty', {}, 'Nobody else working'),
    );
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    const c = w.cubby(cubbyId);
    const composer = w.extension?.compose;
    if (body && chatMode(c) === 'watching' && composer?.allowed()) {
      composer.send(body.slice(0, composer.maxLength)); text.value = ''; return;
    }

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
  const owner = chatMode(c) === 'owner';
  const modal = openModal(el, { doing: owner ? '💬 talking to their lead' : '👀 watching a cubby', onClose: () => { closed = true; off(); w.extension?.close(); } });
  log.scrollTop = log.scrollHeight;
  if (owner && c?.lamp !== 'asleep') setTimeout(() => text.focus(), 30);
  return modal;
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
  const find = (): CubbyAgent | undefined => (chatMode(w.cubby(cubbyId)) ? w.cubby(cubbyId)?.interior?.agents.find((a) => a.id === agentId) : undefined);
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
        h('p.cb-note', {}, `This conversation stays in ${a.tool}. Office shows only its tool, branch and state.`),
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
