// The engine swap (see docs/department-leads.md): hand a worker's task to a replacement worker on
// another engine. The person picks the engine, the office seats an idle replacement in its own
// worktree and prepares the existing one-shot handoff; the exact prompt is reviewed here and
// acknowledged once. The source worker is untouched — session, transcript and branch stay its own.
import type { WorkerHandoff } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, toast } from './dom';
import { agentFields, engineLabel, officeChoice } from './provider';

export function openEngineSwap(net: Net, workerId: string) {
  const worker = store.workers.get(workerId);
  if (!worker) return;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const fields = agentFields(store.project, `swap-${workerId}`, worker.provider ? { provider: worker.provider, ...(worker.model ? { model: worker.model } : {}), ...(worker.effort ? { effort: worker.effort } : {}) } : officeChoice(store.project));
  const note = h('textarea.dept-delegate-task', { rows: 3, maxlength: '4000', spellcheck: 'false', placeholder: 'Why the swap, and anything the replacement must know (optional — the brief is composed from the worker’s task and branch).', 'aria-label': 'Swap note' });
  const stage = h('button.btn.primary', { type: 'button' }, 'Stage the swap');
  const review = h('div');
  const el = h(
    'div.modal.engine-swap',
    { role: 'dialog', 'aria-label': `Replace ${worker.name}’s engine` },
    h('header', {}, h('h2', {}, `🔁 Replace ${worker.name}’s engine`), close),
    h('p.dept-hint', {}, `Now: ${engineLabel(worker, store.project)}. A replacement worker is seated idle in its own worktree; the handoff is delivered once, after both are idle. The source keeps its own session, transcript and branch — send it home when the replacement has taken over.`),
    fields.element,
    note,
    h('div.dept-row', {}, stage),
    review,
  );
  let current: WorkerHandoff | undefined;
  let pending: 'ack' | 'cancel' | undefined;
  const status = h('p.dept-hint', { role: 'status' });
  review.after(status);
  const modal = openModal(el, { doing: `🔁 replacing ${worker.name}’s engine`, onClose: () => { offMsg(); offStatus(); } });

  stage.addEventListener('click', () => {
    if (!fields.valid()) return;
    net.send({ t: 'handoff.swap', workerId, provider: fields.value(), model: fields.model(), effort: fields.effort(), note: note.value.trim() || undefined });
  });

  function render(handoff: WorkerHandoff) {
    current = handoff;
    stage.disabled = true;
    fields.element.style.display = 'none';
    note.hidden = true;
    stage.style.display = 'none';
    const delivered = handoff.state === 'acknowledged';
    const prompt = h('pre.dept-swap-prompt', {}, handoff.prompt);
    const ack = h('button.btn.primary', { type: 'button' }, delivered ? 'Finish role swap' : 'Acknowledge context and send once');
    const cancel = h('button.btn', { type: 'button' }, 'Cancel the swap');
    ack.disabled = !!pending || !net.up || handoff.state === 'delivery-failed';
    cancel.disabled = !!pending || !net.up || delivered;
    const submit = (action: 'ack' | 'cancel') => {
      if (pending || !net.up) return;
      pending = action;
      status.textContent = action === 'ack' ? 'Waiting for the server to confirm the swap…' : 'Waiting for cancellation…';
      render(handoff);
      net.send({ t: action === 'ack' ? 'handoff.ack' : 'handoff.cancel', workerId, handoffId: handoff.id });
    };
    ack.addEventListener('click', () => submit('ack'));
    cancel.addEventListener('click', () => submit('cancel'));
    review.replaceChildren(h('h4', {}, delivered ? 'Handoff sent — finish the role swap' : 'Review the handoff'),
      h('p.dept-hint', {}, delivered ? 'The handoff was already delivered. Finishing retries the role update without sending it again.' : ''),
      prompt, h('div.dept-row', {}, ack, cancel));
  }
  const offMsg = net.onMessage((msg) => {
    if (!el.isConnected) return;
    if (msg.t === 'handoff.preview' && msg.workerId === workerId) render(msg.handoff);
    if (msg.t === 'worker.update' && msg.worker.id === workerId && msg.worker.handoff && msg.worker.swap) render(msg.worker.handoff);
    if (msg.t !== 'handoff.result' || msg.workerId !== workerId || msg.handoffId !== current?.id || msg.action !== pending) return;
    pending = undefined;
    if (!msg.ok) {
      status.textContent = msg.error ?? 'The swap was not completed. Review and retry.';
      render(msg.handoff ?? current);
      return;
    }
    if (msg.action === 'ack') {
      toast(`Swap confirmed — ${worker.name} keeps its own session and branch.`);
      modal.close();
    } else {
      current = undefined;
      stage.disabled = false;
      fields.element.style.display = '';
      note.hidden = false;
      stage.style.display = '';
      review.replaceChildren();
      status.textContent = 'Swap cancelled.';
    }
  });
  const offStatus = net.onStatus((up) => {
    pending = undefined;
    status.textContent = up ? 'Connection restored. Retry to confirm the pending swap; the handoff will not be sent twice.' : 'Disconnected. The swap is not confirmed. Reconnect to retry.';
    if (current) render(current);
  });
  if (worker.handoff && worker.swap) render(worker.handoff);
  close.addEventListener('click', () => modal.close());
}
