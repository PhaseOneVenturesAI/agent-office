// The department's lead (see docs/department-leads.md): one persistent identity per department that
// the person talks to and that orchestrates real workers. The lead hero is the front of the
// departments window — status, current task, Talk — with naming, the team engine policy and
// delegation around it, and the same three actions on the character itself in the 3D office.
import type { AgentEffort, AgentProvider, Department, DeptLead, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, engineLabel, officeChoice } from './provider';
import { openTerminal } from './terminal';
import { openWorkerConversation } from './worker-conversation';
import { openEngineSwap } from './engine-swap';

const PRESET_COLOR: Record<Department['preset'], string> = { marketing: '#e8853d', product: '#4a7dbd', review: '#8a6fbd' };

/** The lead's live worker, when its shift is running. */
const leadWorker = (d: Department): WorkerInfo | undefined => (d.lead?.workerId ? store.workers.get(d.lead.workerId) : undefined);

/** One short line about the lead's shift, for the card and the directory. */
export function leadStatusText(d: Department): string {
  const lead = d.lead;
  if (!lead) return 'no manager yet';
  const w = leadWorker(d);
  if (!w) return `${lead.name} · off shift`;
  if (w.status === 'needs_input') return `${lead.name} · needs you`;
  if (w.status === 'working') return `${lead.name} · working`;
  if (w.status === 'done') return `${lead.name} · turn ended`;
  if (w.status === 'offline') return `${lead.name} · asleep`;
  return `${lead.name} · on shift`;
}

/** A finished turn is not a reviewed result: the chip says what actually happened. */
function statusChip(w: WorkerInfo | undefined) {
  if (!w) return h('span.dept-chip', {}, 'off shift');
  if (w.status === 'needs_input') return h('span.dept-chip.needs', {}, 'needs you');
  if (w.status === 'done') return h('span.dept-chip', {}, 'turn ended');
  if (w.status === 'working') return h('span.dept-chip.live', {}, 'working');
  return h('span.dept-chip', {}, w.status === 'offline' ? 'asleep' : w.status);
}

/** The saved engine line for a lead or policy, or the office default when nothing was saved. */
const choiceText = (c: { provider?: AgentProvider; model?: string; effort?: AgentEffort } | undefined) =>
  c?.provider ? choiceLabel({ provider: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) }) : choiceLabel(officeChoice(store.project));

const prefill = (c: { provider?: AgentProvider; model?: string; effort?: AgentEffort } | undefined) =>
  c?.provider ? { provider: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) } : officeChoice(store.project);

/** Naming or replacing the lead: a name and the engine the next shift starts on. */
export function leadForm(net: Net, d: Department, existing: DeptLead | undefined, done: () => void) {
  const name = h('input.dept-lead-name', { type: 'text', placeholder: 'Their name — Maya, Priya, Dev…', maxlength: '40', 'aria-label': 'Lead name' }) as HTMLInputElement;
  if (existing) name.value = existing.name;
  const fields = agentFields(store.project, `dept-lead-${d.id}`, prefill(existing));
  const save = h('button.btn.small.primary', { type: 'button' }, existing ? 'Save the manager' : 'Name the manager');
  const cancel = h('button.btn.small', { type: 'button', onclick: done }, 'Cancel');
  save.addEventListener('click', () => {
    if (!name.value.trim()) return name.focus();
    if (!fields.valid()) return;
    net.send({ t: 'departments.lead', id: d.id, name: name.value.trim(), provider: fields.value(), model: fields.model(), effort: fields.effort() });
    done();
  });
  return h('div.dept-lead-form', {}, h('div.dept-row', {}, name), fields.element, h('div.dept-row', {}, save, cancel));
}

/** Engine decisions an 'ask' policy held for a person: approve (picking the engine) or reject. */
function requestsBlock(net: Net, d: Department) {
  const block = h('div.dept-requests');
  const paint = () => {
    const requests = d.requests ?? [];
    block.replaceChildren();
    if (!requests.length) return;
    block.append(h('h4', {}, `🙋 ${requests.length} engine decision${requests.length === 1 ? '' : 's'} to make`));
    for (const r of requests) {
      const fields = agentFields(store.project, `dept-req-${r.id}`, prefill(d.policy));
      const row = h(
        'div.dept-request',
        {},
        h('div.dept-row', {}, h('strong', {}, r.title), h('span.dept-meta', {}, `asked by ${r.by} · ${timeAgo(r.at)}`)),
        h('p.dept-hint', {}, r.task),
        fields.element,
        h(
          'div.dept-row',
          {},
          h('button.btn.small.primary', { type: 'button', onclick: () => { if (!fields.valid()) return; net.send({ t: 'departments.request.approve', id: d.id, request: r.id, provider: fields.value(), model: fields.model(), effort: fields.effort() }); } }, 'Approve · queue it'),
          h('button.btn.small', { type: 'button', onclick: () => net.send({ t: 'departments.request.reject', id: d.id, request: r.id }) }, 'Reject'),
        ),
      );
      block.append(row);
    }
  };
  paint();
  return block;
}

/** The team engine policy editor, for Manage/Details: chosen once, silent or ask-each-time. */
export function policyBlock(net: Net, d: Department, repaint: () => void) {
  const block = h('div.dept-block', {}, h('h4', {}, '🧭 Team engine'));
  let editing = false;
  const paint = () => {
    const p = d.policy;
    block.replaceChildren(
      h('h4', {}, '🧭 Team engine'),
      h(
        'div.dept-row',
        {},
        h('span', {}, p ? `${choiceLabel(prefill(p))}${p.mode === 'ask' ? ' · ask each time' : ' · always'}` : `${choiceLabel(officeChoice(store.project))} · office default`),
        h('button.btn.small', { type: 'button', title: 'Choose the provider and model the team runs on', onclick: () => { editing = true; paint(); } }, p ? '✏️ Edit' : 'Choose…'),
      ),
      h('p.dept-hint', {}, 'Lead shifts and delegated work run on this engine. “Ask each time” holds an agent’s delegation for your decision instead of running it silently.'),
    );
    if (editing) {
      const fields = agentFields(store.project, `dept-policy-${d.id}`, prefill(p));
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
  paint();
  return block;
}

/** The delegation form: the lead's job into the one task source, deduped across the project. */
export function delegateBlock(net: Net, d: Department) {
  const title = h('input.dept-task', { type: 'text', placeholder: 'The job, one line — “Homepage hero rewrite”', maxlength: '200', 'aria-label': 'Delegation title' }) as HTMLInputElement;
  const task = h('textarea.dept-delegate-task', { rows: 3, maxlength: '20000', spellcheck: 'false', placeholder: 'What the worker must do, what “done” means, and the evidence to bring back.', 'aria-label': 'Delegation task' }) as HTMLTextAreaElement;
  const ask = d.policy?.mode === 'ask';
  const fields = agentFields(store.project, `dept-delegate-${d.id}`, prefill(d.policy));
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
    h('p.dept-hint', {}, ask ? 'You pick the engine each time — prefilled from the policy.' : d.policy ? `Runs on ${choiceText(d.policy)}.` : `Runs on the office default until a policy is chosen.`),
    title,
    task,
    ...(ask ? [fields.element] : []),
    h('div.dept-row', {}, go),
  );
}

/** The lead hero: the first thing the panel shows — name, status, current task, Talk. */
export function leadBlock(net: Net, d: Department, repaint: () => void) {
  const block = h('div.dept-lead');
  let naming = false;
  let changingEngine = false;
  const paint = () => {
    const lead = d.lead;
    const w = leadWorker(d);
    block.replaceChildren();
    if (!lead) {
      block.append(
        h('h4', {}, '🎖️ Manager'),
        h('p.empty', {}, 'Name one manager for this department — they staff the roles, watch the work and tell you what’s blocked.'),
        naming ? leadForm(net, d, undefined, () => { naming = false; paint(); }) : h('button.btn.small.primary', { type: 'button', onclick: () => { naming = true; paint(); } }, 'Name the manager'),
      );
      return;
    }
    const ask = d.policy?.mode === 'ask';
    const head = h(
      'div.dept-lead-hero',
      {},
      h('span.dept-avatar', { style: `background:${PRESET_COLOR[d.preset]}` }, lead.name.slice(0, 1).toUpperCase()),
      h('div.dept-lead-id', {}, h('strong', {}, lead.name), statusChip(w)),
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
          h('button.btn.small.primary', { type: 'button', title: 'Talk to the manager', onclick: () => openWorkerConversation(net, w.id, () => openTerminal(net, w.id)) }, '💬 Talk'),
          h('button.btn.small', { type: 'button', onclick: () => openDeptTeam(net, d) }, '👥 Team'),
          h('button.btn.small', { type: 'button', onclick: () => openDeptWork(net, d) }, '📋 Work'),
        ),
      );
      actions.append(
        h('span.dept-engine', { title: 'The engine this lead runs on' }, `⚙️ ${engineLabel(w, store.project)}`),
        h('button.btn.small.link', { type: 'button', title: 'The saved engine for the next shift', onclick: () => { changingEngine = !changingEngine; paint(); } }, 'Change'),
      );
    } else {
      const first = h('input.dept-task', { type: 'text', placeholder: 'First thing on their plate (optional)', maxlength: '200' }) as HTMLInputElement;
      const fields = agentFields(store.project, `dept-shift-${d.id}`, prefill(d.policy ?? lead));
      const start = h('button.btn.small.primary', { type: 'button' }, `Start ${lead.name}’s shift`);
      start.addEventListener('click', () => {
        if (ask && !fields.valid()) return;
        net.send({ t: 'departments.lead.launch', id: d.id, prompt: first.value.trim() || undefined, ...(ask ? { provider: fields.value(), model: fields.model(), effort: fields.effort() } : {}) });
      });
      block.append(
        head,
        h('p.dept-hint', {}, ask ? 'Pick the engine for this shift — prefilled from the policy.' : `Their shift runs on ${choiceText(d.policy ?? lead)}.`),
        first,
        ...(ask ? [fields.element] : []),
        h('div.dept-row', {}, start),
      );
      actions.append(h('span.dept-engine', { title: 'The saved engine for the next shift' }, `⚙️ ${choiceText(lead)}`), h('button.btn.small.link', { type: 'button', onclick: () => { changingEngine = !changingEngine; paint(); } }, 'Change'));
    }
    if (changingEngine) {
      const fields = agentFields(store.project, `dept-engine-${d.id}`, prefill(lead));
      const save = h('button.btn.small.primary', { type: 'button' }, 'Save engine');
      save.addEventListener('click', () => {
        if (!fields.valid()) return;
        net.send({ t: 'departments.lead', id: d.id, name: lead.name, provider: fields.value(), model: fields.model(), effort: fields.effort() });
        changingEngine = false;
        paint();
      });
      block.append(h('div.dept-lead-form', {}, fields.element, h('div.dept-row', {}, save, h('button.btn.small', { type: 'button', onclick: () => { changingEngine = false; paint(); } }, 'Cancel'))));
    }
    const requests = requestsBlock(net, d);
    if (requests.childElementCount) block.append(requests);
  };
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
      const role = r.role === 'lead' ? '🎖️ Manager' : (d.roles.find((x) => x.id === r.role)?.name ?? '?');
      if (!w) return h('div.dept-row', {}, h('span', {}, 'a worker (gone)'), h('span.dept-meta', {}, `${role} · hired by ${r.by} · ${timeAgo(r.at)}`));
      const task = w.task ? `${w.task.name}: ${w.task.summary}` : w.prompt;
      return h(
        'div.dept-row',
        {},
        h('span', {}, `${w.name} — ${w.status === 'done' ? 'turn ended' : w.status.replace('_', ' ')}`),
        h('span.dept-meta', {}, `${role} · ${engineLabel(w, store.project)}${task ? ` · ${task}` : ''}`),
        h('button.btn.small', { type: 'button', onclick: () => openTerminal(net, w.id) }, '🖥️'),
        w.kind === 'agent' ? h('button.btn.small', { type: 'button', title: 'Hand this worker’s task to a replacement engine', onclick: () => { modal.close(); openEngineSwap(net, w.id); } }, '🔁') : null,
      );
    });
    list.replaceChildren(...(rows.length ? rows.flatMap((x) => (x ? [x] : [])) : [h('p.empty', {}, 'Nobody is staffed here yet — hire into a role or start the lead’s shift.')]));
  };
  const modal = openModal(el, { doing: `👥 viewing the ${d.name} team`, onClose: () => off() });
  const off = store.on('workers', () => el.isConnected && paint());
  close.addEventListener('click', () => modal.close());
  paint();
}

/** View work: the department's delegations in the floor queue, with honest states. */
export function openDeptWork(net: Net, d: Department) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div');
  const el = h('div.modal.dept-work', { role: 'dialog', 'aria-label': `${d.name} work` }, h('header', {}, h('h2', {}, `📋 ${d.name} · Work`), close), list);
  const paint = () => {
    const mine = store.queue.tasks.filter((t) => t.dept === d.id);
    const chip = (t: (typeof mine)[number]) => (t.status === 'done' ? h('span.dept-chip', {}, t.outcome === 'done' ? 'turn ended' : (t.outcome ?? 'done')) : h('span.dept-chip', {}, t.status === 'running' ? 'working' : t.status));
    const meta = (t: (typeof mine)[number]) => {
      if (t.status === 'running') return [t.workerName, t.branch].filter(Boolean).join(' · ');
      if (t.status === 'queued') return `waiting for a desk · ${t.addedBy}`;
      // Turn ended is the worker's own report, not a review: say what is and isn't proven.
      if (t.outcome === 'done') return [t.pr ? `PR #${t.pr.number} opened · not yet reviewed` : 'turn ended · no PR yet', t.workerName].filter(Boolean).join(' · ');
      return [t.error ?? `stopped (${t.outcome})`, t.workerName].filter(Boolean).join(' · ');
    };
    const rows = mine.map((t) =>
      h(
        'div.dept-row',
        {},
        chip(t),
        h('span', { title: t.prompt }, t.title),
        h('span.dept-meta', {}, meta(t)),
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

/** The 3D approach: walking up to the lead's character offers the same three actions. */
export function openLeadChooser(net: Net, d: Department, workerId: string) {
  const w = store.workers.get(workerId);
  if (!w) return;
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
    { role: 'dialog', 'aria-label': `Talk to ${d.lead?.name ?? w.name}` },
    h('header', {}, h('h2', {}, `🎖️ ${d.lead?.name ?? w.name} — ${d.name} manager`), close),
    h('p.dept-hint', {}, sub),
    h(
      'div.dept-row',
      {},
      h('button.btn.primary', { type: 'button', onclick: () => { modal.close(); openWorkerConversation(net, workerId, () => openTerminal(net, workerId)); } }, '💬 Talk'),
      h('button.btn', { type: 'button', onclick: () => { modal.close(); openDeptTeam(net, d); } }, '👥 View team'),
      h('button.btn', { type: 'button', onclick: () => { modal.close(); openDeptWork(net, d); } }, '📋 View work'),
      h('button.btn', { type: 'button', onclick: () => { modal.close(); openTerminal(net, workerId); } }, '🖥️ Terminal'),
    ),
  );
  const modal = openModal(el, { doing: `🎖️ talking to ${d.lead?.name ?? w.name}` });
  close.addEventListener('click', () => modal.close());
}
