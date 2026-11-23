import type { ApprovalState } from '../../shared/protocol/approvals';
import type { Net } from '../net';
import { h } from './dom';
import './approval-card.css';
/** Mount in Conversation. It never invents choices from worker activity or terminal output. */
export function approvalCard(net: Net, workerId: string, terminal: () => void) {
  const element = h('section.approval-panel', { 'aria-label': 'Agent approvals', 'aria-live': 'polite' });
  let state: ApprovalState = { queued: 0 }, submitting: string | undefined, terminalAfter: string | undefined, alive = true;
  const message = h('p.note', { role: 'status' });
  const render = () => {
    const request = state.request;
    if (submitting && request?.id !== submitting) submitting = undefined;
    const children: HTMLElement[] = [];
    if (request) {
      const options = h('div.approval-choices');
      for (const option of request.options) options.append(h('button.btn', { type: 'button', disabled: !net.up || submitting === request.id, 'data-option-id': option.id,
        onclick: () => { submitting = request.id; message.textContent = 'Submitting this choice…'; net.send({ t: 'approval.answer', workerId, requestId: request.id, optionId: option.id }); render(); } }, option.label));
      options.append(h('button.btn', { type: 'button', disabled: !net.up || submitting === request.id, onclick: () => {
        submitting = request.id; terminalAfter = request.id; net.send({ t: 'approval.terminal', workerId, requestId: request.id }); render();
      } }, 'Use Terminal'));
      children.push(h('div.approval-card', {}, h('strong', {}, '✋ Your decision'), h('h3', {}, request.title),
        h('p.note', {}, `${request.provider} · ${state.queued > 1 ? `${state.queued} requests waiting · oldest first` : 'This request only'}`),
        h('pre', { tabindex: 0, 'aria-label': 'Exact permission request details' }, request.detail), options,
        h('p.note', {}, request.source === 'permission-hook' ? 'Bound to this live permission hook. Other provider rules can still deny the action.' : 'These are the choices supplied by Kimi for this exact request.')));
    } else if (state.fallback) children.push(h('div.approval-card', {}, h('p', {}, state.fallback), h('button.btn', { type: 'button', onclick: terminal }, 'Open Terminal')));
    if (message.textContent) children.push(message);
    element.replaceChildren(...children);
  };
  const unsubscribe = net.onMessage((msg) => {
    if (!alive) return;
    if (msg.t === 'approval.state' && msg.workerId === workerId) { state = msg.state; render(); }
    if (msg.t === 'approval.result' && msg.workerId === workerId && msg.requestId === submitting) {
      submitting = undefined;
      if (msg.error) { message.textContent = msg.error; terminalAfter = undefined; }
      else if (terminalAfter === msg.requestId) { terminalAfter = undefined; terminal(); return; }
      else { message.textContent = 'Choice submitted to the provider. This is not confirmation that the tool succeeded.'; state = { queued: Math.max(0, state.queued - 1) }; }
      render();
    }
  });
  net.send({ t: 'approval.open', workerId });
  return { element, /** Invoke with the conversation's existing connection paint. */ paint: render,
    close() { alive = false; unsubscribe(); net.send({ t: 'approval.close', workerId }); } };
}
