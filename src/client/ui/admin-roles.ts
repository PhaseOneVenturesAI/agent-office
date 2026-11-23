// The Roles view (see docs/department-leads.md): one place to see who the project's characters
// are and who controls them — the CEO (private to its owner) and each department manager (its
// controllers, Q&A audience, billing custodian, engine, effective autonomy). Everyday talking
// happens on the characters themselves or the Departments window; this is the administration
// surface, and every edit here is authorized again server-side.
import type { Department } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { agentFields, choiceLabel, engineLabel, officeChoice } from './provider';
import { openTerminal } from './terminal';
import { openWorkerConversation } from './worker-conversation';

const prefill = (c: { provider?: import('../../shared/protocol').AgentProvider; model?: string; effort?: import('../../shared/protocol').AgentEffort } | undefined) =>
  c?.provider ? { provider: c.provider, ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) } : officeChoice(store.project);

/** The staff Ask box: read-only Q&A on a separate no-tools session (never the manager's own). */
function askBox(net: Net, d: Department) {
  const input = h('input.dept-task', { type: 'text', placeholder: 'Ask a read-only question…', maxlength: '4000', 'aria-label': 'Read-only question' }) as HTMLInputElement;
  const answer = h('div.dept-qa-answer');
  const go = h('button.btn.small', { type: 'button' }, 'Ask (read-only)');
  go.addEventListener('click', () => {
    if (!input.value.trim()) return input.focus();
    answer.replaceChildren(h('p.dept-hint', {}, 'Asking on a separate read-only session — never the manager’s own…'));
    net.send({ t: 'departments.ask', id: d.id, question: input.value.trim() });
    input.value = '';
  });
  return { element: h('div', {}, h('div.dept-row', {}, input, go), answer), answer };
}

const AUTONOMY = ['off', 'supervised', 'autonomous'];

function autonomyRow(net: Net, kind: 'ceo' | 'dept', id: string | undefined, current: string | undefined, who: string) {
  const select = h('select.dept-policy-mode', { 'aria-label': 'Effective autonomy' }, ...AUTONOMY.map((a) => h('option', { value: a }, a))) as HTMLSelectElement;
  select.value = current ?? 'off';
  select.title = 'What the provider actually supports; the office never approves terminal text blindly. Unknown support shows as information only.';
  select.addEventListener('change', () => {
    if (kind === 'ceo') net.send({ t: 'ceo.set', name: who, autonomy: select.value });
    else if (id) net.send({ t: 'departments.lead', id, name: who, autonomy: select.value });
  });
  return h('div.dept-row', {}, h('span.dept-meta', {}, 'Autonomy'), select, h('span.dept-meta', {}, '— applied only where the provider supports it; otherwise information only'));
}

function engineRow(net: Net, kind: 'ceo' | 'dept', id: string | undefined, current: { provider?: import('../../shared/protocol').AgentProvider; model?: string; effort?: import('../../shared/protocol').AgentEffort } | undefined, who: string) {
  let editing = false;
  const row = h('div.dept-row', {}, h('span.dept-meta', {}, `Engine: ${current?.provider ? choiceLabel(prefill(current)) : choiceLabel(officeChoice(store.project))}`));
  const edit = h('button.btn.small.link', { type: 'button' }, 'Change');
  row.append(edit);
  const wrap = h('div', {}, row);
  edit.addEventListener('click', () => {
    editing = !editing;
    wrap.querySelector('.dept-lead-form')?.remove();
    if (!editing) return;
    const fields = agentFields(store.project, `roles-engine-${kind}-${id ?? 'ceo'}`, prefill(current));
    const save = h('button.btn.small.primary', { type: 'button' }, 'Save engine');
    save.addEventListener('click', () => {
      if (!fields.valid()) return;
      if (kind === 'ceo') net.send({ t: 'ceo.set', name: who, provider: fields.value(), model: fields.model(), effort: fields.effort() });
      else if (id) net.send({ t: 'departments.lead', id, name: who, provider: fields.value(), model: fields.model(), effort: fields.effort() });
    });
    wrap.append(h('div.dept-lead-form', {}, fields.element, h('div.dept-row', {}, save)));
  });
  return wrap;
}

/** A comma-separated email list editor. */
function emailsRow(label: string, values: string[] | undefined, placeholder: string, onSave: (emails: string[]) => void) {
  const input = h('input.dept-task', { type: 'text', placeholder, maxlength: '300', 'aria-label': label }) as HTMLInputElement;
  input.value = (values ?? []).join(', ');
  const save = h('button.btn.small', { type: 'button' }, 'Save');
  save.addEventListener('click', () => {
    const emails = input.value.split(',').map((e) => e.trim()).filter(Boolean);
    onSave(emails);
    toast(`${label} saved`, 'info');
  });
  return h('div', {}, h('div.dept-row', {}, h('span.dept-meta', { style: 'min-width:120px' }, label), input, save));
}

/** The Roles window: CEO + managers, who controls them, and the scoped quick edits. */
export function openRoles(net: Net) {
  if (!store.floor) return;
  const floor = store.floor;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div.roles-list');
  const el = h('div.modal.roles', { role: 'dialog', 'aria-label': 'Roles' }, h('header', {}, h('h2', {}, '🛡️ Roles'), close), list);

  const qaBoxes = new Map<string, HTMLElement>();
  const paint = () => {
    qaBoxes.clear();
    const parts: HTMLElement[] = [];
    const ceo = store.ceo.ceo;
    // --- the CEO ---------------------------------------------------------------------------
    const ceoBlock = h('section.dept', {}, h('h4', {}, '👔 CEO'));
    if (!ceo) {
      ceoBlock.append(h('p.empty', {}, 'No CEO on this project yet. An office admin sets one up; from then on only its owner talks to it or edits it.'));
    } else {
      const w = ceo.workerId ? store.workers.get(ceo.workerId) : undefined;
      const ownerLine = ceo.owner ? `owner: ${ceo.owner}` : 'no owner configured — set AGENT_OFFICE_CEO_OWNER or have an admin designate one';
      ceoBlock.append(
        h('div.dept-row', {}, h('strong', {}, ceo.name), w ? h('span.dept-chip', {}, w.status === 'needs_input' ? 'needs you' : w.status === 'done' ? 'turn ended' : w.status) : h('span.dept-chip', {}, 'off shift'), h('span.dept-meta', {}, `${ownerLine} · named by ${ceo.by} · ${timeAgo(ceo.at)}`)),
        w
          ? h('div.dept-row', {}, h('button.btn.small.primary', { type: 'button', onclick: () => openWorkerConversation(net, w.id, () => openTerminal(net, w.id)) }, '💬 Talk'), h('button.btn.small', { type: 'button', title: 'Hand their seat to a replacement engine (owner only)', onclick: () => import('./engine-swap').then((m) => m.openEngineSwap(net, w.id)) }, '🔁 Swap engine'))
          : h('button.btn.small', { type: 'button', onclick: () => net.send({ t: 'ceo.launch' }) }, `Start ${ceo.name}’s shift`),
        engineRow(net, 'ceo', undefined, ceo, ceo.name),
        autonomyRow(net, 'ceo', undefined, ceo.autonomy, ceo.name),
        // Ownership passes only by the current owner's delegation (admin bootstraps an unowned CEO).
        h('div.dept-row', {}, h('input.dept-task', { type: 'text', placeholder: 'Owner email — delegated by the current owner', maxlength: '120', 'aria-label': 'CEO owner', value: ceo.owner ?? '', onchange: (e) => net.send({ t: 'ceo.set', name: ceo.name, owner: (e.target as HTMLInputElement).value.trim() }) })),
      );
    }
    parts.push(ceoBlock);
    // --- the managers ----------------------------------------------------------------------
    for (const d of store.departments.departments) {
      const ask = askBox(net, d);
      qaBoxes.set(d.id, ask.answer);
      const block = h(
        'section.dept',
        {},
        h('h4', {}, `🎖️ ${d.name} manager`),
        ...(d.lead
          ? [
              h('div.dept-row', {}, h('strong', {}, d.lead.name), h('span.dept-meta', {}, `named by ${d.lead.by} · ${timeAgo(d.lead.at)}`)),
              ...(d.lead.objective ? [h('p.dept-hint', {}, `Objective: ${d.lead.objective.text}`)] : []),
              engineRow(net, 'dept', d.id, d.lead, d.lead.name),
              autonomyRow(net, 'dept', d.id, d.lead.autonomy, d.lead.name),
              emailsRow('Controllers', d.lead.controllers, 'ivanv@…, eduardo@…', (emails) => net.send({ t: 'departments.access', id: d.id, controllers: emails })),
              emailsRow('Q&A audience', d.lead.audience, 'empty = any signed-in colleague', (emails) => net.send({ t: 'departments.access', id: d.id, audience: emails })),
              h('div.dept-row', {}, h('span.dept-meta', { style: 'min-width:120px' }, 'Custodian'), h('input.dept-task', { type: 'text', placeholder: 'billing/credential custodian email', maxlength: '120', 'aria-label': 'Custodian', value: d.lead.custodian ?? '', onchange: (e) => net.send({ t: 'departments.access', id: d.id, custodian: (e.target as HTMLInputElement).value.trim() }) })),
              ask.element,
            ]
          : [h('p.empty', {}, 'No manager named yet.')]),
      );
      parts.push(block);
    }
    list.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  const onMessage = (msg: import('../../shared/protocol').ServerMsg) => {
    if (msg.t === 'departments.qa') {
      const box = qaBoxes.get(msg.id);
      box?.replaceChildren(h('p.dept-hint', {}, `Q: ${msg.question}`), h('p.dept-brief', {}, msg.answer));
    }
  };
  const offs = [net.onMessage(onMessage), store.on('departments', paint), store.on('ceo', paint), store.on('workers', paint)];
  const modal = openModal(el, { doing: '🛡️ reviewing roles', onClose: () => offs.forEach((o) => o()) });
  close.addEventListener('click', () => modal.close());
  offs.push(store.on('floor', () => modal.close()));
  paint();
}
