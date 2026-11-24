// The floor's CEO (see docs/department-leads.md): one persistent identity per project, talked to
// at their desk like any worker. The hero is the front of the departments window — name them,
// start their shift explicitly, talk to them, give a manager an objective — while the department
// cards below keep their own managers, who can still be talked to directly.
import type { DeptPreset, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, engineLabel, officeChoice } from './provider';
import { openTerminal } from './terminal';
import { openWorkerConversation } from './worker-conversation';
import { openEngineSwap } from './engine-swap';

const CEO_COLOR = '#2b6f4e';

/** The CEO's live worker, while their shift runs. */
const ceoWorker = (): WorkerInfo | undefined => {
  const id = store.ceo.ceo?.workerId;
  return id ? store.workers.get(id) : undefined;
};

/** One short status line for the hero and chooser. */
export function ceoStatusText(): string {
  const ceo = store.ceo.ceo;
  if (!ceo) return 'no CEO yet';
  const w = ceoWorker();
  if (!w) return `${ceo.name} · off shift`;
  if (w.status === 'needs_input') return `${ceo.name} · needs you`;
  if (w.status === 'working') return `${ceo.name} · working`;
  if (w.status === 'done') return `${ceo.name} · turn ended`;
  if (w.status === 'offline') return `${ceo.name} · asleep`;
  return `${ceo.name} · on shift`;
}

const chip = (w: WorkerInfo | undefined) => {
  if (!w) return h('span.dept-chip', {}, 'off shift');
  if (w.status === 'needs_input') return h('span.dept-chip.needs', {}, 'needs you');
  if (w.status === 'done') return h('span.dept-chip', {}, 'turn ended');
  if (w.status === 'working') return h('span.dept-chip.live', {}, 'working');
  return h('span.dept-chip', {}, w.status === 'offline' ? 'asleep' : w.status);
};

const prefill = (c: { provider?: import('../../shared/protocol').AgentProvider; model?: string; effort?: import('../../shared/protocol').AgentEffort } | undefined) =>
  c?.provider ? { provider: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) } : officeChoice(store.project);

/** Naming (or replacing) the CEO: a name and the engine the next shift starts on. */
function ceoForm(net: Net, done: () => void) {
  const existing = store.ceo.ceo;
  const name = h('input.dept-lead-name', { type: 'text', placeholder: 'Their name — Avery, Sam…', maxlength: '40', 'aria-label': 'CEO name' }) as HTMLInputElement;
  if (existing) name.value = existing.name;
  const fields = agentFields(store.project, 'deco-name', prefill(existing));
  const save = h('button.btn.small.primary', { type: 'button' }, existing ? 'Save the CEO' : 'Name the CEO');
  save.addEventListener('click', () => {
    if (!name.value.trim()) return name.focus();
    if (!fields.valid()) return;
    net.send({ t: 'ceo.set', name: name.value.trim(), provider: fields.value(), model: fields.model(), effort: fields.effort() });
    done();
  });
  return h('div.dept-lead-form', {}, h('div.dept-row', {}, name), fields.element, h('div.dept-row', {}, save, h('button.btn.small', { type: 'button', onclick: done }, 'Cancel')));
}

/** The human's assignment row: pick a manager, write the objective, optionally start them. */
function assignRow(net: Net) {
  const depts = store.departments.departments.filter((d) => d.lead);
  if (!depts.length) return h('p.dept-hint', {}, 'Name a department manager first — then the CEO can be given someone to direct.');
  const select = h('select.dept-policy-mode', { 'aria-label': 'Manager' }, ...depts.map((d) => h('option', { value: d.preset }, d.name))) as HTMLSelectElement;
  const objective = h('input.dept-task', { type: 'text', placeholder: 'The objective, one line — “Ship the homepage hero v2”', maxlength: '4000', 'aria-label': 'Objective' }) as HTMLInputElement;
  const execute = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const go = h('button.btn.small.primary', { type: 'button' }, 'Give the objective');
  go.addEventListener('click', () => {
    if (!objective.value.trim()) return objective.focus();
    net.send({ t: 'ceo.assign', dept: select.value as DeptPreset, objective: objective.value.trim(), execute: execute.checked });
    objective.value = '';
    execute.checked = false;
  });
  return h(
    'div',
    {},
    h('div.dept-row', {}, select, objective),
    h('div.dept-row', {}, h('label', {}, execute, ' start them if they’re off shift'), go),
  );
}

/** The CEO hero at the top of the departments window. */
export function ceoBlock(net: Net, repaint: () => void) {
  const block = h('div.dept-lead.dept-ceo');
  let naming = false;
  let changingEngine = false;
  const paint = () => {
    const ceo = store.ceo.ceo;
    const w = ceoWorker();
    block.replaceChildren();
    if (!ceo) {
      block.append(
        h('h4', {}, '👔 CEO'),
        h('p.empty', {}, 'Name one CEO for this project — they direct the managers, and you talk to them here or at their desk.'),
        naming ? ceoForm(net, () => { naming = false; paint(); }) : h('button.btn.small.primary', { type: 'button', onclick: () => { naming = true; paint(); } }, 'Name the CEO'),
      );
      return;
    }
    const head = h(
      'div.dept-lead-hero',
      {},
      h('span.dept-avatar', { style: `background:${CEO_COLOR}` }, ceo.name.slice(0, 1).toUpperCase()),
      h('div.dept-lead-id', {}, h('strong', {}, ceo.name), chip(w)),
      h('div.dept-lead-actions'),
    );
    const actions = head.querySelector('.dept-lead-actions') as HTMLElement;
    if (w) {
      if (w.status === 'needs_input') block.append(h('p.dept-hint', {}, `Stopped on something — ${w.activity ?? 'open their terminal to answer it'}.`));
      const taskLine = w.task ? `${w.task.name}: ${w.task.summary}` : w.activity;
      block.append(
        head,
        ...(taskLine ? [h('p.dept-lead-task', {}, taskLine)] : []),
        h(
          'div.dept-row',
          {},
          h('button.btn.small.primary', { type: 'button', title: 'Talk to the CEO', onclick: () => openWorkerConversation(net, w.id, () => openTerminal(net, w.id)) }, '💬 Talk'),
          h('button.btn.small', { type: 'button', onclick: () => openCeoWork(net) }, '📋 Work'),
          h('button.btn.small', { type: 'button', title: 'Hand their seat to a replacement engine', onclick: () => openEngineSwap(net, w.id) }, '🔁'),
        ),
        assignRow(net),
      );
      actions.append(
        h('span.dept-engine', { title: 'The engine this CEO runs on' }, `⚙️ ${engineLabel(w, store.project)}`),
        h('button.btn.small.link', { type: 'button', title: 'The saved engine for the next shift', onclick: () => { changingEngine = !changingEngine; paint(); } }, 'Change'),
      );
    } else {
      const first = h('input.dept-task', { type: 'text', placeholder: 'First thing on their plate (optional)', maxlength: '200' }) as HTMLInputElement;
      const fields = agentFields(store.project, 'deco-shift', prefill(ceo));
      const start = h('button.btn.small.primary', { type: 'button' }, `Start ${ceo.name}’s shift`);
      start.addEventListener('click', () => {
        if (!fields.valid()) return;
        net.send({ t: 'ceo.launch', prompt: first.value.trim() || undefined, provider: fields.value(), model: fields.model(), effort: fields.effort() });
      });
      block.append(
        head,
        h('p.dept-hint', {}, `Their shift runs on ${ceo.provider ? choiceLabel(prefill(ceo)) : choiceLabel(officeChoice(store.project))}.`),
        first,
        fields.element,
        h('div.dept-row', {}, start),
        assignRow(net),
      );
      actions.append(h('span.dept-engine', { title: 'The saved engine for the next shift' }, `⚙️ ${ceo.provider ? choiceLabel(prefill(ceo)) : choiceLabel(officeChoice(store.project))}`), h('button.btn.small.link', { type: 'button', onclick: () => { changingEngine = !changingEngine; paint(); } }, 'Change'));
    }
    if (changingEngine) {
      const fields = agentFields(store.project, 'deco-engine', prefill(ceo));
      const save = h('button.btn.small.primary', { type: 'button' }, 'Save engine');
      save.addEventListener('click', () => {
        if (!fields.valid()) return;
        net.send({ t: 'ceo.set', name: ceo.name, provider: fields.value(), model: fields.model(), effort: fields.effort() });
        changingEngine = false;
        paint();
      });
      block.append(h('div.dept-lead-form', {}, fields.element, h('div.dept-row', {}, save, h('button.btn.small', { type: 'button', onclick: () => { changingEngine = false; paint(); } }, 'Cancel'))));
    }
    block.append(
      h(
        'details.dept-advanced',
        {},
        h('summary', {}, 'Replace the CEO'),
        naming ? ceoForm(net, () => { naming = false; paint(); }) : h('div.dept-row', {}, h('button.btn.small', { type: 'button', title: 'Replace the identity — the character is permanent; this renames it', onclick: () => { naming = true; paint(); } }, 'Replace…')),
      ),
    );
  };
  paint();
  return block;
}

/** The CEO's work view: every department's delegated work with its chain, plus live objectives. */
export function openCeoWork(net: Net) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div');
  const el = h('div.modal.dept-work', { role: 'dialog', 'aria-label': 'CEO work' }, h('header', {}, h('h2', {}, '👔 CEO · Work'), close), list);
  const paint = () => {
    const parts: HTMLElement[] = [];
    for (const d of store.departments.departments) {
      const lead = d.lead;
      if (lead?.objective) parts.push(h('div.dept-row', {}, h('span.dept-chip', {}, 'objective'), h('span', {}, `${lead.name} (${d.name})`), h('span.dept-meta', {}, lead.objective.text)));
      const mine = store.queue.tasks.filter((t) => t.dept === d.id);
      for (const t of mine) {
        const w = t.workerId ? store.workers.get(t.workerId) : undefined;
        const chipText = t.status === 'done' ? (t.outcome === 'done' ? 'turn ended' : (t.outcome ?? 'done')) : t.status === 'running' ? 'working' : t.status;
        const meta =
          t.status === 'done'
            ? t.outcome === 'done'
              ? [t.pr ? `PR #${t.pr.number} opened · not yet reviewed` : 'turn ended · no PR yet', w?.name].filter(Boolean).join(' · ')
              : [t.error ?? `stopped (${t.outcome})`, w?.name].filter(Boolean).join(' · ')
            : [w?.name, t.status === 'queued' ? 'waiting for a desk' : ''].filter(Boolean).join(' · ');
        parts.push(
          h('div.dept-row', {}, h('span.dept-chip', {}, chipText), h('span', { title: t.prompt }, `${d.name} — ${t.title}`), h('span.dept-meta', {}, meta), t.pr ? h('a.btn.small', { href: t.pr.url, target: '_blank', rel: 'noopener' }, `🔀 #${t.pr.number}`) : null),
        );
      }
    }
    const waiting = store.reviews.items.filter((i) => i.floorId === store.floor && i.status === 'pending').length;
    list.replaceChildren(
      ...(parts.length ? parts : [h('p.empty', {}, 'Nothing in flight — give a manager an objective, or talk to the CEO.')]),
      h('p.dept-meta', {}, `${waiting ? `${waiting} take${waiting === 1 ? '' : 's'} waiting in the Review Room · ` : ''}turn ended is the worker’s own report, not a review · the floor queue is the project’s one task source.`),
    );
  };
  const modal = openModal(el, { doing: '👔 viewing CEO work', onClose: () => offs.forEach((o) => o()) });
  const offs = [store.on('queue', paint), store.on('workers', paint), store.on('departments', paint)];
  close.addEventListener('click', () => modal.close());
  paint();
}

/** The 3D approach: walking up to the CEO's character. */
export function openCeoChooser(net: Net, workerId: string) {
  const w = store.workers.get(workerId);
  const ceo = store.ceo.ceo;
  if (!w || !ceo) return;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const sub =
    w.status === 'needs_input'
      ? 'They stopped on something — Talk opens the conversation; the answer itself goes in their terminal.'
      : w.status === 'working'
        ? 'Working — Talk opens the conversation; their terminal shows the run.'
        : w.status === 'done'
          ? 'Their turn ended — hear what they found.'
          : 'On shift and ready.';
  const el = h(
    'div.modal.dept-chooser',
    { role: 'dialog', 'aria-label': `Talk to ${ceo.name}` },
    h('header', {}, h('h2', {}, `👔 ${ceo.name} — CEO`), close),
    h('p.dept-hint', {}, sub),
    h(
      'div.dept-row',
      {},
      h('button.btn.primary', { type: 'button', onclick: () => { modal.close(); openWorkerConversation(net, workerId, () => openTerminal(net, workerId)); } }, '💬 Talk'),
      h('button.btn', { type: 'button', onclick: () => { modal.close(); openCeoWork(net); } }, '📋 View work'),
      h('button.btn', { type: 'button', onclick: () => { modal.close(); openTerminal(net, workerId); } }, '🖥️ Terminal'),
    ),
    h('p.dept-meta', {}, `Named by ${ceo.by} · ${timeAgo(ceo.at)}`),
  );
  const modal = openModal(el, { doing: `👔 talking to ${ceo.name}` });
  close.addEventListener('click', () => modal.close());
}
