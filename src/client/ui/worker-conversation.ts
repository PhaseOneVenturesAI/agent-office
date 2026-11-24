import { approvalCard } from './approval-card';
import type { ConversationMessage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { dictation, onDictating } from './dictate';
import { agentSpeaker } from './agent-speech';
import { openWorkerHandoff } from './worker-handoff';
import './worker-conversation.css';

let current: Modal | undefined;

/** Message text with URLs made clickable (artifact links, PRs, staged takes). */
function richText(text: string): (string | HTMLElement)[] {
  const parts: (string | HTMLElement)[] = [];
  let rest = text;
  for (;;) {
    const m = /https?:\/\/[^\s<>"')\]]+/.exec(rest);
    if (!m) break;
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    const url = m[0].replace(/[.,;:!?]+$/, '');
    parts.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
    rest = rest.slice(m.index + url.length);
  }
  if (rest) parts.push(rest);
  return parts;
}

export function openWorkerConversation(net: Net, workerId: string, terminal: () => void) {
  current?.close();
  const worker = store.workers.get(workerId);
  if (!worker) return;
  const floor = store.floor, speaker = agentSpeaker();
  let supported = false, listening = false, alive = true, historyEnd = false, loadingEarlier = false;
  const close = h('button.btn.close', { 'aria-label': 'Close conversation' }, '✕');
  const terminalButton = h('button.btn', { type: 'button' }, 'Terminal');
  const handoff = h('button.btn', { type: 'button' }, 'Handoff');
  const note = h('p.note', {}, 'Loading this existing agent…');
  const engineDetails = h('p.note');
  const approvals = approvalCard(net, workerId, () => { modal.close(); terminal(); });
  const earlier = h('button.btn.small', { type: 'button' }, 'Load earlier messages');
  const transcript = h('div.conversation-transcript', { role: 'log', 'aria-label': 'Conversation transcript', 'aria-live': 'polite' });
  const draft = h('textarea', { rows: 3, maxlength: 20000, 'aria-label': 'Message draft', placeholder: 'Type or dictate, review the draft, then Send.' });
  const send = h('button.btn.primary', { type: 'submit', disabled: true }, 'Send');
  const voice = h('input', { type: 'checkbox', disabled: !speaker.available });
  const stop = h('button.btn', { type: 'button' }, 'Stop audio');
  const interrupt = h('button.btn', { type: 'button', disabled: true }, 'Interrupt turn');
  const mic = dictation({ off: () => draft.disabled, insert: (text) => { draft.value += `${draft.value ? ' ' : ''}${text}`; } }, { label: 'Dictate draft' });
  const offDictating = onDictating((on) => { listening = on; if (on) speaker.stop(); });
  const form = h('form', {}, draft, mic.live, h('div.conversation-actions', {}, mic.button, send));
  const el = h('div.modal.worker-conversation', { role: 'dialog', 'aria-label': `${worker.name} conversation` },
    h('header', {}, h('h2', {}, `${worker.name} · Conversation`), close), h('div.body', {},
      h('div.conversation-actions', {}, terminalButton, handoff), note, approvals.element,
      earlier, transcript, form,
      h('div.conversation-actions', {}, h('label', {}, voice, ' Speak new replies'), stop, interrupt),
      h('details', {}, h('summary', {}, 'Conversation details'), engineDetails,
        h('p.note', {}, 'You’re talking to this agent in its existing session. Open Terminal for setup prompts and other terminal actions.'),
        h('p.note', {}, speaker.available ? 'Dictation and read-aloud use your browser/OS speech. Closing or disconnecting stops audio.' : 'Speech is unavailable in this browser; typed messages still work.'))));
  const renderMessage = (m: ConversationMessage, fresh: boolean) => {
    if (transcript.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
    const who = m.role === 'assistant' ? worker.name : m.by ? `You (${m.by})` : 'You';
    transcript.append(h('article', { 'data-id': m.id, 'data-at': String(m.at), class: m.scope === 'staff' ? 'staff' : '' }, h('strong', {}, who), h('p', {}, ...richText(m.text))));
    while (transcript.children.length > 200) transcript.firstElementChild?.remove();
    transcript.scrollTop = transcript.scrollHeight;
    if (fresh && m.role === 'assistant' && !listening) speaker.say(m.text.replace(/https?:\/\/\S+/g, 'link'));
    if (fresh && m.role === 'user') draft.value = '';
  };
  const paint = () => {
    const w = store.workers.get(workerId);
    if (!w || store.floor !== floor) return current?.close();
    draft.disabled = !net.up || !supported || !!w.lost;
    send.disabled = draft.disabled || !['idle', 'done'].includes(w.status);
    interrupt.disabled = !net.up || w.status !== 'working';
    const statusLine = w.status === 'done' ? 'turn ended — not yet reviewed' : w.status === 'needs_input' ? 'waiting on a human decision' : w.status === 'exited' ? 'stopped — not completed' : w.status;
    note.textContent = !net.up
      ? 'Disconnected. Draft kept; reconnect to continue.'
      : !supported
        ? 'Structured replies are unavailable for this provider; use its terminal.'
        : `${w.provider ?? 'Agent'} · ${statusLine}`;
    engineDetails.textContent = `Selected model: ${w.model ?? 'provider default'}. Last reported: ${w.usage?.model ?? 'unknown'}. Subscription quota is unavailable here.`;
    approvals.paint();
  };
  const offMessage = net.onMessage((msg) => {
    if (!alive) return;
    if (msg.t === 'conversation.state' && msg.workerId === workerId) { supported = msg.supported; transcript.replaceChildren(); historyEnd = false; for (const m of msg.messages) renderMessage(m, false); paint(); }
    if (msg.t === 'conversation.message' && msg.workerId === workerId) renderMessage(msg.message, true);
    if (msg.t === 'conversation.history' && msg.workerId === workerId) {
      loadingEarlier = false;
      historyEnd = msg.end;
      earlier.classList.toggle('hidden', historyEnd);
      for (const m of [...msg.messages].reverse()) {
        if (transcript.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) continue;
        const first = transcript.firstElementChild;
        const article = h('article', { 'data-id': m.id, 'data-at': String(m.at), class: m.scope === 'staff' ? 'staff' : '' }, h('strong', {}, m.role === 'assistant' ? worker.name : m.by ? `You (${m.by})` : 'You'), h('p', {}, ...richText(m.text)));
        if (first) transcript.insertBefore(article, first); else transcript.append(article);
      }
    }
  });
  earlier.onclick = () => {
    if (loadingEarlier || historyEnd) return;
    const oldest = transcript.querySelector('article');
    const at = oldest?.getAttribute('data-at');
    loadingEarlier = true;
    net.send({ t: 'conversation.page', workerId, before: at ? Number(at) : Date.now() });
  };
  const offStatus = net.onStatus((up) => { speaker.stop(); mic.stop(); if (up) { net.send({ t: 'conversation.open', workerId }); approvals.reconnect(); } paint(); });
  const offWorkers = store.on('workers', paint);
  const modal = openModal(el, { onClose: () => {
    alive = false; approvals.close(); speaker.enable(false); mic.drop(); offDictating(); offMessage(); offStatus(); offWorkers();
    net.send({ t: 'conversation.close', workerId }); if (current === modal) current = undefined;
  } });
  current = modal;
  close.onclick = () => modal.close();
  terminalButton.onclick = () => approvals.openTerminal();
  handoff.onclick = () => { modal.close(); openWorkerHandoff(net, workerId); };
  voice.onchange = () => speaker.enable(voice.checked);
  stop.onclick = () => { speaker.stop(); mic.stop(); };
  interrupt.onclick = () => { speaker.stop(); mic.stop(); net.send({ t: 'conversation.interrupt', workerId }); };
  form.onsubmit = (e) => { e.preventDefault(); if (send.disabled || !draft.value.trim()) return; speaker.stop(); mic.stop(); net.send({ t: 'conversation.send', workerId, text: draft.value }); };
  paint();
  net.send({ t: 'conversation.open', workerId });
}
