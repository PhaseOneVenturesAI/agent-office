// The department's lead (see docs/department-leads.md): one persistent identity per department that
// the person talks to and that orchestrates real workers. This is the lead card in the departments
// window — status, Talk / View team / View work, naming and replacing the lead, the team engine
// policy, and delegation into the floor queue.
import type { AgentEffort, AgentProvider, Department, DeptLead, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, STATUS_LABEL, timeAgo } from './dom';
import { agentFields, choiceLabel, engineLabel, officeChoice } from './provider';
import { openTerminal } from './terminal';
import { openWorkerConversation } from './worker-conversation';
import { openEngineSwap } from './engine-swap';

/** The lead's live worker, when its shift is running. */
const leadWorker = (d: Department): WorkerInfo | undefined => (d.lead?.workerId ? store.workers.get(d.lead.workerId) : undefined);

/** One line about the lead's shift, for the card and the directory. */
export function leadStatusText(d: Department): string {
  const lead = d.lead;
  if (!lead) return 'no lead';
  const w = leadWorker(d);
  if (!w) return `${lead.name} · off shift`;
  if (w.status === 'needs_input') return `${lead.name} · needs you`;
  if (w.status === 'working') return `${lead.name} · working`;
  if (w.status === 'done') return `${lead.name} · done`;
  if (w.status === 'offline') return `${lead.name} · asleep`;
  return `${lead.name} · on shift`;
}

/** The saved engine line for a lead or policy, or the office default when nothing was saved. */
const choiceText = (c: { provider?: AgentProvider; model?: string; effort?: AgentEffort } | undefined) =>
  c?.provider ? choiceLabel({ provider: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) }) : choiceLabel(officeChoice(store.project));

/** Naming/replacing the lead: a name and its engine, saved as the identity's default. */
function leadForm(net: Net, d: Department, existing: DeptLead | undefined, done: () => void) {
  const name = h('input.dept-lead-name', { type: 'text', placeholder: 'Their name — Maya, Priya, Dev…', maxlength: '40', 'aria-label': 'Lead name' }) as HTMLInputElement;
  if (existing) name.value = existing.name;
  const fields = agentFields(store.project, `dept-lead-${d.id}`, existing?.provider ? { provider: existing.provider, ...(existing.model ? { model: existing.model } : {}), ...(existing.effort ? { effort: existing.effort } : {}) } : officeChoice(store.project));
  const save = h('button.btn.small.primary', { type: 'button' }, existing ? 'Save the lead' : 'Name the lead');
  const cancel = h('button.btn.small', { type: 'button', onclick: done }, 'Cancel');
  save.addEventListener('click', () => {
    if (!name.value.trim()) return name.focus();
    if (!fields.valid()) return;
    net.send({ t: 'departments.lead', id: d.id, name: name.value.trim(), provider: fields.value(), model: fields.model(), effort: fields.effort() });
    done();
  });
  return h('div.dept-lead-form', {}, h('div.dept-row', {}, name), fields.element, h('div.dept-row', {}, save, cancel));
}

/** The team engine policy row: what lead launches and delegations run on, silently or asked each time. */
export function policyBlock(net: Net, d: Department, repaint: () => void) {
  const block = h('div.dept-block', {}, h('h4', {}, '🧭 Team engine'));
  const paint = () => {
    const p = d.policy;
    block.replaceChildren(
      h('h4', {}, '🧭 Team engine'),
      h(
        'div.dept-row',
        {},
        h('span', {}, p ? `${choiceLabel({ provider: p.provider, ...(p.model ? { model: p.model } : {}), ...(p.effort ? { effort: p.effort } : {}) })}${p.mode === 'ask' ? ' · ask each time' : ' · always'}` : `${choiceLabel(officeChoice(store.project))} · office default`),
        h('button.btn.small', { type: 'button', title: 'Choose the provider and model the team runs on', onclick: () => { editing = true; paint(); } }, p ? '✏️ Edit' : 'Choose…'),
      ),
      h('p.dept-hint', {}, 'Lead shifts and delegated work run on this engine. “Ask each time” shows the picker instead of running it silently. Nothing switches engines on its own.'),
    );
    if (editing) {
      const fields = agentFields(store.project, `dept-policy-${d.id}`, p ? { provider: p.provider, ...(p.model ? { model: p.model } : {}), ...(p.effort ? { effort: p.effort } : {}) } : officeChoice(store.project));
      const mode = h('select.dept-policy-mode', { 'aria-label': 'When to ask' }, h('option', { value: 'policy' }, 'Use silently'), h('option', { value: 'ask' }, 'Ask each time')) as HTMLSelectElement;
      mode.value = p?.mode ?? 'policy';
      const save = h('button.btn.small.primary', { type: 'button' }, 'Save policy');
      save.addEventListener('click', () => {
        if (!fields.valid()) return;
        net.send({ t: 'departments.policy', id: d.id, provider: fields.value(), model: fields.model(), effort: fields.effort(), mode: mode.value as 'policy' | 'ask' });
        editing = false;
        paint();
      });
      block.append(fields.element, h('div.dept-row', {}, mode, save, h('button.btn.small', { type: 'button', onclick: () => { editing = false; paint(); } }, 'Cancel')));
    }
  };
  let editing = false;
  paint();
  return block;
}

/** The delegation form: the lead's job into the one task source, deduped per department. */
export function delegateBlock(net: Net, d: Department) {
  const title = h('input.dept-task', { type: 'text', placeholder: 'The job, one line — “Homepage hero rewrite”', maxlength: '200', 'aria-label': 'Delegation title' }) as HTMLInputElement;
  const task = h('textarea.dept-delegate-task', { rows: 3, maxlength: '20000', spellcheck: 'false', placeholder: 'What the worker must do, what “done” means, and the evidence to bring back.', 'aria-label': 'Delegation task' }) as HTMLTextAreaElement;
  const ask = d.policy?.mode === 'ask';
  const fields = agentFields(store.project, `dept-delegate-${d.id}`, d.policy ? { provider: d.policy.provider, ...(d.policy.model ? { model: d.policy.model } : {}), ...(d.policy.effort ? { effort: d.policy.effort } : {}) } : officeChoice(store.project));
  const go = h('button.btn.small.primary', { type: 'button' }, 'Delegate to the queue');
  const send = () => {
    if (!title.value.trim()) return title.focus();
    if (!task.value.trim()) return task.focus();
    if (ask && !fields.valid()) return;
    net.send({ t: 'departments.delegate', id: d.id, title: title.value.trim(), task: task.value.trim(), ...(ask ? { provider: fields.value(), model: fields.model(), effort: fields.effort() } : {}) });
    title.value = '';
    task.value = '';
  };
  go.addEventListener('click', send);
  return h(
    'div.dept-block',
    {},
    h('h4', {}, '📮 Delegate'),
    h('p.dept-hint', {}, ask ? 'Pick the engine each time — prefilled from the policy.' : d.policy ? `Runs on ${choiceText(d.policy)}.` : `Runs on the office default until a policy is chosen.`),
    title,
    task,
    ...(ask ? [fields.element] : []),
    h('div.dept-row', {}, go),
  );
}

/** The lead card for the selected department's panel. */
export function leadBlock(net: Net, d: Department, repaint: () => void) {
  const block = h('div.dept-block.dept-lead');
  const paint = () => {
    const lead = d.lead;
    const w = leadWorker(d);
    block.replaceChildren(h('h4', {}, '🎖️ Lead'));
    if (!lead) {
      block.append(
        h('p.empty', {}, 'No lead yet. Name one and start their shift: they staff the roles, watch the work and report results and blockers — you talk to them instead of chasing desks.'),
        naming ? leadForm(net, d, undefined, () => { naming = false; paint(); }) : h('button.btn.small', { type: 'button', onclick: () => { naming = true; paint(); } }, 'Name the lead'),
      );
      return;
    }
    const chip = !w ? h('span.dept-chip', {}, 'off shift') : w.status === 'needs_input' ? h('span.dept-chip.needs', {}, 'needs you') : h('span.dept-chip', {}, STATUS_LABEL[w.status] ?? w.status);
    block.append(
      h('div.dept-lead-head', {}, h('strong', {}, `🎖️ ${lead.name}`), chip, h('span.dept-meta', {}, `named by ${lead.by} · ${timeAgo(lead.at)}`)),
      h('div.dept-row', {}, h('span.dept-meta', {}, `Engine: ${choiceText(lead)}`)),
    );
    if (w) {
      if (w.status === 'needs_input') block.append(h('p.dept-hint', {}, `Stopped on something — ${w.activity ?? 'open their terminal to answer it'}.`));
      if (w.status === 'done' && w.task) block.append(h('p.dept-hint', {}, `Done: ${w.task.name} — ${w.task.summary}`));
      block.append(
        h(
          'div.dept-row',
          {},
          h('button.btn.small.primary', { type: 'button', title: 'Talk to the lead', onclick: () => openWorkerConversation(net, w.id, () => openTerminal(net, w.id)) }, '💬 Talk'),
          h('button.btn.small', { type: 'button', onclick: () => openDeptTeam(net, d) }, '👥 View team'),
          h('button.btn.small', { type: 'button', onclick: () => openDeptWork(net, d) }, '📋 View work'),
        ),
      );
    } else {
      const first = h('input.dept-task', { type: 'text', placeholder: 'First thing on their plate (optional)', maxlength: '200' }) as HTMLInputElement;
      const ask = d.policy?.mode === 'ask';
      const fields = agentFields(store.project, `dept-shift-${d.id}`, d.policy ? { provider: d.policy.provider, ...(d.policy.model ? { model: d.policy.model } : {}), ...(d.policy.effort ? { effort: d.policy.effort } : {}) } : officeChoice(store.project));
      const start = h('button.btn.small.primary', { type: 'button' }, `Start ${lead.name}’s shift`);
      start.addEventListener('click', () => {
        if (ask && !fields.valid()) return;
        net.send({ t: 'departments.lead.launch', id: d.id, prompt: first.value.trim() || undefined, ...(ask ? { provider: fields.value(), model: fields.model(), effort: fields.effort() } : {}) });
      });
      block.append(
        h('p.dept-hint', {}, ask ? 'Pick the engine for this shift — prefilled from the policy.' : `Their shift runs on ${choiceText(d.policy ?? lead)}.`),
        first,
        ...(ask ? [fields.element] : []),
        h('div.dept-row', {}, start),
      );
    }
    block.append(
      h(
        'details.dept-advanced',
        {},
        h('summary', {}, 'Replace or retire the lead'),
        naming ? leadForm(net, d, lead, () => { naming = false; paint(); }) : h('div.dept-row', {}, h('button.btn.small', { type: 'button', onclick: () => { naming = true; paint(); } }, 'Replace…')),
        h('div.dept-row', {}, h('button.btn.small', { type: 'button', title: 'Retire the lead identity; their worker, when on shift, keeps its desk', onclick: () => net.send({ t: 'departments.lead.clear', id: d.id }) }, 'Retire the lead')),
      ),
    );
  };
  let naming = false;
  paint();
  return block;
}

/** View team: the roster with each worker's live state, engine and work. */
export function openDeptTeam(net: Net, d: Department) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div');
  const el = h('div.modal.dept-team', { role: 'dialog', 'aria-label': `${d.name} team` }, h('header', {}, h('h2', {}, `👥 ${d.name} · Team`), close), list);
  const paint = () => {
    const rows = d.roster.map((r) => {
      const w = store.workers.get(r.workerId);
      const role = r.role === 'lead' ? '🎖️ Lead' : (d.roles.find((x) => x.id === r.role)?.name ?? '?');
      if (!w) return h('div.dept-row', {}, h('span', {}, 'a worker (gone)'), h('span.dept-meta', {}, `${role} · hired by ${r.by} · ${timeAgo(r.at)}`));
      const task = w.task ? `${w.task.name}: ${w.task.summary}` : w.prompt;
      return h(
        'div.dept-row',
        {},
        h('span', {}, `${w.name} — ${STATUS_LABEL[w.status] ?? w.status}`),
        h('span.dept-meta', {}, `${role} · ${engineLabel(w, store.project)}${task ? ` · ${task}` : ''}`),
        h('button.btn.small', { type: 'button', onclick: () => openTerminal(net, w.id) }, '🖥️'),
        h('button.btn.small', { type: 'button', title: 'Hand the task to a replacement engine', onclick: () => { modal.close(); openEngineSwap(net, w.id); } }, '🔁 Engine'),
      );
    });
    list.replaceChildren(...(rows.length ? rows : [h('p.empty', {}, 'Nobody is staffed here yet — hire into a role or start the lead’s shift.')]));
  };
  const modal = openModal(el, { doing: `👥 viewing the ${d.name} team`, onClose: () => off() });
  const off = store.on('workers', () => el.isConnected && paint());
  close.addEventListener('click', () => modal.close());
  paint();
}

/** View work: the department's delegations in the floor queue, with states and outcomes. */
export function openDeptWork(net: Net, d: Department) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div');
  const el = h('div.modal.dept-work', { role: 'dialog', 'aria-label': `${d.name} work` }, h('header', {}, h('h2', {}, `📋 ${d.name} · Work`), close), list);
  const paint = () => {
    const mine = store.queue.tasks.filter((t) => t.dept === d.id);
    const chip = (t: (typeof mine)[number]) => (t.status === 'done' ? h('span.dept-chip', {}, t.outcome === 'done' ? 'finished' : t.outcome ?? 'done') : h('span.dept-chip', {}, t.status));
    const rows = mine.map((t) =>
      h(
        'div.dept-row',
        {},
        chip(t),
        h('span', { title: t.prompt }, t.title),
        h('span.dept-meta', {}, [t.workerName, t.status === 'done' ? (t.outcome === 'done' ? (t.pr ? `PR #${t.pr.number}` : 'finished') : (t.error ?? t.outcome ?? '')) : (t.workerName ? '' : 'waiting for a desk')].filter(Boolean).join(' · ')),
        t.pr ? h('a.btn.small', { href: t.pr.url, target: '_blank', rel: 'noopener' }, `🔀 #${t.pr.number}`) : null,
      ),
    );
    const waiting = store.reviews.items.filter((i) => i.floorId === store.floor && i.status === 'pending').length;
    list.replaceChildren(
      ...(rows.length ? rows : [h('p.empty', {}, 'Nothing delegated yet — the lead assigns work into the floor queue, one job at a time.')]),
      h('p.dept-meta', {}, `${waiting ? `${waiting} take${waiting === 1 ? '' : 's'} waiting in the Review Room · ` : ''}the floor queue is the project’s one task source; departments only delegate into it.`),
    );
  };
  const modal = openModal(el, { doing: `📋 viewing ${d.name} work`, onClose: () => offs.forEach((o) => o()) });
  const offs = [store.on('queue', paint), store.on('reviews', paint)];
  close.addEventListener('click', () => modal.close());
  paint();
}
