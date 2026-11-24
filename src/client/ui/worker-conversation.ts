import type { ConversationMessage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { dictation, onDictating } from './dictate';
import { agentSpeaker } from './agent-speech';
import { openWorkerHandoff } from './worker-handoff';
import './worker-conversation.css';

let current: Modal | undefined;

export function openWorkerConversation(net: Net, workerId: string, terminal: () => void) {
  current?.close();
  const worker = store.workers.get(workerId);
  if (!worker) return;
  const floor = store.floor, speaker = agentSpeaker();
  let supported = false, listening = false, alive = true;
  const close = h('button.btn.close', { 'aria-label': 'Close conversation' }, '✕');
  const terminalButton = h('button.btn', { type: 'button' }, 'Terminal / approvals');
  const handoff = h('button.btn', { type: 'button' }, 'Handoff');
  const note = h('p.note', {}, 'Loading this existing agent…');
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
      h('div.conversation-actions', {}, terminalButton, handoff), note,
      h('p.note', {}, 'New complete replies appear here; earlier history remains in the terminal. The selected agent keeps its existing session and model. Tool approvals stay in the terminal.'),
      transcript, form,
      h('div.conversation-actions', {}, h('label', {}, voice, ' Speak new replies'), stop, interrupt),
      h('p.note', {}, speaker.available ? 'Speech uses your browser/OS voice. Known credential patterns are suppressed; review sensitive work in text. Closing or disconnecting stops audio.' : 'Speech playback is unavailable in this browser. Typed messages still work.')));
  const renderMessage = (m: ConversationMessage, fresh: boolean) => {
    if (transcript.querySelector(`[data-id="${CSS.escape(m.id)}"]`)) return;
    transcript.append(h('article', { 'data-id': m.id }, h('strong', {}, m.role === 'assistant' ? worker.name : 'You'), h('p', {}, m.text)));
    while (transcript.children.length > 30) transcript.firstElementChild?.remove();
    transcript.scrollTop = transcript.scrollHeight;
    if (fresh && m.role === 'assistant' && !listening) speaker.say(m.text);
    if (fresh && m.role === 'user') draft.value = '';
  };
  const paint = () => {
    const w = store.workers.get(workerId);
    if (!w || store.floor !== floor) return current?.close();
    draft.disabled = !net.up || !supported || !!w.lost;
    send.disabled = draft.disabled || !['idle', 'done'].includes(w.status);
    interrupt.disabled = !net.up || w.status !== 'working';
    note.textContent = !net.up ? 'Disconnected. Draft kept; reconnect to continue.' : !supported ? 'Structured replies are unavailable for this provider; use its terminal.' : w.status === 'needs_input' ? 'This agent needs a human answer. Open Terminal / approvals.' : `${w.provider ?? 'Agent'} · ${w.status} · selected model ${w.model ?? 'provider default'} · last reported ${w.usage?.model ?? 'unknown'}`;
  };
  const offMessage = net.onMessage((msg) => {
    if (!alive) return;
    if (msg.t === 'conversation.state' && msg.workerId === workerId) { supported = msg.supported; transcript.replaceChildren(); for (const m of msg.messages) renderMessage(m, false); paint(); }
    if (msg.t === 'conversation.message' && msg.workerId === workerId) renderMessage(msg.message, true);
  });
  const offStatus = net.onStatus((up) => { speaker.stop(); mic.stop(); if (up) net.send({ t: 'conversation.open', workerId }); paint(); });
  const offWorkers = store.on('workers', paint);
  const modal = openModal(el, { onClose: () => {
    alive = false; speaker.enable(false); mic.drop(); offDictating(); offMessage(); offStatus(); offWorkers();
    net.send({ t: 'conversation.close', workerId }); if (current === modal) current = undefined;
  } });
  current = modal;
  close.onclick = () => modal.close();
  terminalButton.onclick = () => { modal.close(); terminal(); };
  handoff.onclick = () => { modal.close(); openWorkerHandoff(net, workerId); };
  voice.onchange = () => speaker.enable(voice.checked);
  stop.onclick = () => { speaker.stop(); mic.stop(); };
  interrupt.onclick = () => { speaker.stop(); mic.stop(); net.send({ t: 'conversation.interrupt', workerId }); };
  form.onsubmit = (e) => { e.preventDefault(); if (send.disabled || !draft.value.trim()) return; speaker.stop(); mic.stop(); net.send({ t: 'conversation.send', workerId, text: draft.value }); };
  paint();
  net.send({ t: 'conversation.open', workerId });
}
