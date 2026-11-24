import type { Department } from '../../shared/protocol';
import type { Net } from '../net';
import { h } from './dom';

/** The staff Ask box: read-only Q&A on a separate no-tools session (never the manager's own). */
export function askBox(net: Net, d: Department) {
  const input = h('input.dept-task', { type: 'text', placeholder: 'Ask a read-only question…', maxlength: '4000', 'aria-label': 'Read-only question' }) as HTMLInputElement;
  const answer = h('div.dept-qa-answer');
  const go = h('button.btn.small', { type: 'button' }, 'Ask (read-only)');
  let pending: string | undefined;
  go.addEventListener('click', () => {
    if (pending) return;
    if (!input.value.trim()) return input.focus();
    answer.replaceChildren(h('p.dept-hint', {}, 'Asking on a separate read-only session — never the manager’s own…'));
    pending = crypto.randomUUID(); go.disabled = true;
    net.send({ t: 'departments.ask', id: d.id, question: input.value.trim(), requestId: pending });
  });
  return { element: h('div', {}, h('div.dept-row', {}, input, go), answer), receive: (msg: Extract<import('../../shared/protocol').ServerMsg, {t:'departments.qa'}>) => {
    if (!pending || msg.requestId !== pending) return;
    pending = undefined; go.disabled = !net.up;
    answer.replaceChildren(h('p.dept-hint', {}, `Q: ${msg.question}`), h('p.dept-brief', { role: 'status' }, msg.error ?? msg.answer));
  }, disconnected: (up: boolean) => { if (pending) { pending = undefined; answer.textContent = 'Question not confirmed. Your draft is kept; reconnect to retry.'; } go.disabled = !up; } };
}
