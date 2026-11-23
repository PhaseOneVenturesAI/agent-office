import type { WorkerHandoff } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import './worker-conversation.css';

export function openWorkerHandoff(net: Net, workerId: string) {
  const source = store.workers.get(workerId);
  if (!source) return;
  const close = h('button.btn.close', { 'aria-label': 'Close handoff' }, '✕');
  const target = h('select', { 'aria-label': 'Existing recipient' });
  for (const w of store.workers.values()) if (w.kind === 'agent' && w.id !== workerId) target.append(h('option', { value: w.id }, `${w.name} · ${w.worktree?.branch ?? 'shared workspace'}`));
  const brief = h('textarea', { rows: 3, maxlength: 6000, 'aria-label': 'Scoped brief', placeholder: 'Outcome, file scope, accepted decisions and constraints' });
  const evidence = h('textarea', { rows: 3, maxlength: 4000, 'aria-label': 'Verification evidence', placeholder: 'Commit, tests, limitations; say unverified where appropriate' });
  const next = h('textarea', { rows: 2, maxlength: 3000, 'aria-label': 'Next step', placeholder: 'One concrete next step' });
  const prepare = h('button.btn', { type: 'submit' }, 'Review exact handoff');
  const form = h('form.handoff-form', {}, h('label', {}, 'Existing recipient', target), h('label', {}, 'Scoped brief', brief), h('label', {}, 'Human-supplied evidence', evidence), h('label', {}, 'Next step', next), prepare);
  const preview = h('section');
  const el = h('div.modal.worker-conversation', { role: 'dialog', 'aria-label': 'Worker handoff' }, h('header', {}, h('h2', {}, `Handoff · ${source.name}`), close), h('div.body', {},
    h('p.note', {}, 'Optional: transfer task responsibility to an existing agent in a separate worktree. This does not stop the source agent, move credentials, create an agent, or merge branches. Both agents must be idle before sending.'), form, preview));
  const paint = (handoff?: WorkerHandoff) => {
    if (!handoff || handoff.from !== workerId) return;
    preview.replaceChildren(h('h3', {}, handoff.state === 'pending' ? 'Review before sending' : `Handoff ${handoff.state}`), h('p.note', {}, `${handoff.fromName} → ${handoff.toName}. Evidence is human-supplied. Source work stays where it is.`), h('pre.handoff-preview', {}, handoff.prompt));
    form.hidden = handoff.state === 'pending';
    if (handoff.state === 'pending') {
      const ack = h('button.btn.primary', { type: 'button' }, 'Acknowledge context and send once');
      const cancel = h('button.btn', { type: 'button' }, 'Cancel this handoff');
      ack.addEventListener('click', () => net.send({ t: 'handoff.ack', workerId, handoffId: handoff.id }));
      cancel.addEventListener('click', () => net.send({ t: 'handoff.cancel', workerId, handoffId: handoff.id }));
      preview.append(h('div.conversation-actions', {}, ack, cancel));
    } else preview.append(h('p.note', {}, 'Receipt saved before delivery. If Office restarted during sending, inspect the recipient before preparing anything else; this receipt is never replayed automatically.'));
  };
  const off = net.onMessage((msg) => {
    if (msg.t === 'handoff.preview' && msg.workerId === workerId) paint(msg.handoff);
    if (msg.t === 'worker.update' && msg.worker.id === workerId) {
      if (msg.worker.handoff) paint(msg.worker.handoff);
      else { preview.replaceChildren(); form.hidden = false; }
    }
  });
  const modal = openModal(el, { onClose: off });
  close.onclick = () => modal.close();
  form.onsubmit = (e) => { e.preventDefault(); net.send({ t: 'handoff.prepare', workerId, targetId: target.value, brief: { brief: brief.value, evidence: evidence.value, next: next.value } }); };
  paint(source.handoff);
}
