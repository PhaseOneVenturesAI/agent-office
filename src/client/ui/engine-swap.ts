// The engine swap (see docs/department-leads.md): hand a worker's task to a replacement worker on
// another engine. The person picks the engine, the office seats an idle replacement in its own
// worktree and prepares the existing one-shot handoff; the exact prompt is reviewed here and
// acknowledged once. The source worker is untouched — session, transcript and branch stay its own.
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
  const modal = openModal(el, { doing: `🔁 replacing ${worker.name}’s engine`, onClose: () => offMsg() });

  stage.addEventListener('click', () => {
    if (!fields.valid()) return;
    net.send({ t: 'handoff.swap', workerId, provider: fields.value(), model: fields.model(), effort: fields.effort(), note: note.value.trim() || undefined });
  });

  // The server's review: the exact handoff prompt, acknowledged once or cancelled.
  const onMessage = (msg: import('../../shared/protocol').ServerMsg) => {
    if (!el.isConnected) return;
    if (msg.t !== 'handoff.preview' || msg.workerId !== workerId) return;
    const prompt = h('pre.dept-swap-prompt', {}, msg.handoff.prompt);
    const ack = h('button.btn.primary', { type: 'button' }, 'Acknowledge context and send once');
    ack.addEventListener('click', () => {
      ack.disabled = true;
      net.send({ t: 'handoff.ack', workerId, handoffId: msg.handoff.id });
      toast(`Handoff to the replacement sent — ${worker.name} keeps its own session and branch.`);
      modal.close();
    });
    const cancel = h('button.btn', { type: 'button' }, 'Cancel the swap');
    cancel.addEventListener('click', () => {
      net.send({ t: 'handoff.cancel', workerId, handoffId: msg.handoff.id });
      review.replaceChildren(h('p.dept-hint', {}, 'Swap cancelled — the idle replacement can be sent home from the floor.'));
    });
    review.replaceChildren(h('h4', {}, 'Review the handoff'), prompt, h('div.dept-row', {}, ack, cancel));
  };
  const offMsg = net.onMessage(onMessage);
  close.addEventListener('click', () => modal.close());
}
