import './role-settings.css';
import { roleSettings, type RoleSettings } from './role-settings';
import { roleSubscription } from './role-subscription';
// The Roles view (see docs/department-leads.md): one place to see who the project's characters
// are and who controls them — the CEO (private to its owner) and each department manager (its
// controllers, Q&A audience, billing custodian, engine, requested autonomy and launch policy). Everyday talking
// happens on the characters themselves or the Departments window; this is the administration
// surface, and every edit here is authorized again server-side.
import type { Department } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
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

const AUTONOMY = ['off', 'supervised', 'autonomous'];

function autonomyRow(net: Net, saves: RoleSettings, kind: 'ceo' | 'dept', id: string | undefined, current: string | undefined, who: string) {
  const select = h('select.dept-policy-mode', { 'aria-label': 'Requested autonomy' }, ...AUTONOMY.map((a) => h('option', { value: a }, a))) as HTMLSelectElement;
  select.value = current ?? 'off';
  select.title = 'Requested policy for the next new session. The current session’s launch settings are shown separately.';
  const status = h('span.dept-meta', { role: 'status' });
  const save = h('button.btn.small', { type: 'button' }, 'Save autonomy');
  save.onclick = () => {
    const message = kind === 'ceo' ? { t: 'ceo.set' as const, name: who, autonomy: select.value } : { t: 'departments.lead' as const, id: id!, name: who, autonomy: select.value };
    saves.send(message, status, save, 'Autonomy');
  };
  return h('div.dept-row', {}, h('span.dept-meta', {}, 'Autonomy'), select, save, status, h('span.dept-meta', { 'data-role-autonomy': kind === 'ceo' ? 'ceo' : id }, 'Checking current session settings…'));
}

function engineRow(net: Net, saves: RoleSettings, kind: 'ceo' | 'dept', id: string | undefined, current: { provider?: import('../../shared/protocol').AgentProvider; model?: string; effort?: import('../../shared/protocol').AgentEffort } | undefined, who: string) {
  let editing = false;
  const row = h('div.dept-row', {}, h('span.dept-meta', { 'data-role-engine': kind === 'ceo' ? 'ceo' : id }, `Engine: ${current?.provider ? choiceLabel(prefill(current)) : choiceLabel(officeChoice(store.project))}`));
  const edit = h('button.btn.small.link', { type: 'button' }, 'Change');
  row.append(edit);
  const wrap = h('div', {}, row);
  edit.addEventListener('click', () => {
    editing = !editing;
    wrap.querySelector('.dept-lead-form')?.remove();
    if (!editing) return;
    const latest = kind === 'ceo' ? store.ceo.ceo : store.departments.departments.find(d => d.id === id)?.lead;
    const fields = agentFields(store.project, `roles-engine-${kind}-${id ?? 'ceo'}`, prefill(latest ?? current));
    const save = h('button.btn.small.primary', { type: 'button' }, 'Save engine');
    const status = h('p.dept-meta', { role: 'status' });
    save.addEventListener('click', () => {
      if (!fields.valid()) return;
      if (kind === 'ceo') saves.send({ t: 'ceo.set', name: who, provider: fields.value(), model: fields.model(), effort: fields.effort() }, status, save, 'Engine');
      else if (id) saves.send({ t: 'departments.lead', id, name: who, provider: fields.value(), model: fields.model(), effort: fields.effort() }, status, save, 'Engine');
    });
    wrap.append(h('div.dept-lead-form', {}, fields.element, h('div.dept-row', {}, save), status));
  });
  return wrap;
}

function ceoActions(net: Net) {
  const talk = h('button.btn.small.primary', {type:'button', 'data-ceo-talk':true}, 'Talk');
  talk.onclick = () => { const id = store.ceo.ceo?.workerId; if (id && store.workers.has(id)) openWorkerConversation(net, id, () => openTerminal(net, id)); else net.send({t:'ceo.launch'}); };
  const swap = h('button.btn.small', {type:'button', 'data-ceo-swap':true}, '🔁 Swap engine');
  swap.onclick = () => { const id = store.ceo.ceo?.workerId; if (id && store.workers.has(id)) void import('./engine-swap').then(m => m.openEngineSwap(net,id)); };
  return h('div.dept-row', {}, talk, swap);
}

/** A comma-separated email list editor. */
function emailsRow(label: string, values: string[] | undefined, placeholder: string, onSave: (emails: string[], status: HTMLElement, button: HTMLButtonElement) => void) {
  const input = h('input.dept-task', { type: 'text', placeholder, maxlength: '300', 'aria-label': label }) as HTMLInputElement;
  input.value = (values ?? []).join(', ');
  const save = h('button.btn.small', { type: 'button' }, 'Save');
  const status = h('p.dept-meta', {role: 'status'});
  save.addEventListener('click', () => {
    const emails = input.value.split(',').map((e) => e.trim()).filter(Boolean);
    if (emails.some(email => !email.includes('@')) || emails.length > 20) { status.textContent = 'Enter up to 20 email addresses.'; return; }
    if ((label === 'Custodian' || label === 'CEO owner') && emails.length > 1) { status.textContent = 'Choose one email address for this role.'; return; }
    onSave(emails, status, save);
  });
  return h('div', {}, h('div.dept-row', {}, h('span.dept-meta', { style: 'min-width:120px' }, label), input, save), status);
}

/** The Roles window: CEO + managers, who controls them, and the scoped quick edits. */
export function openRoles(net: Net) {
  if (!store.floor) return;
  const floor = store.floor;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const list = h('div.roles-list');
  const el = h('div.modal.roles', { role: 'dialog', 'aria-label': 'Roles' }, h('header', {}, h('h2', {}, '🛡️ Roles'), close), list);

  const saves = roleSettings(net, floor);
  const qaBoxes = new Map<string, ReturnType<typeof askBox>>();
  const sections = new Map<string, HTMLElement>();
  const consentOffs: (() => void)[] = [];
  const consentScopes = new Map<string, string>();
  const runtime = () => {
    const ceoWorker = store.ceo.ceo?.workerId ? store.workers.get(store.ceo.ceo.workerId) : undefined;
    const talk = list.querySelector<HTMLButtonElement>('[data-ceo-talk]'); if (talk) talk.textContent = ceoWorker ? '💬 Talk' : 'Start shift';
    const owner = list.querySelector<HTMLElement>('[data-ceo-owner]'); if (owner) owner.textContent = `Owner: ${store.ceo.ceo?.owner ?? 'not configured'}`;
    const swap = list.querySelector<HTMLButtonElement>('[data-ceo-swap]'); if (swap) swap.disabled = !ceoWorker;
    for (const span of list.querySelectorAll<HTMLElement>('[data-worker-status]')) { const w = span.dataset.workerStatus === 'ceo' ? ceoWorker : store.workers.get(span.dataset.workerStatus!); span.textContent = w?.status ?? 'off shift'; }
    for (const span of list.querySelectorAll<HTMLElement>('[data-role-autonomy]')) {
      const id = span.dataset.roleAutonomy!;
      const role = id === 'ceo' ? store.ceo.ceo : store.departments.departments.find(d => d.id === id)?.lead;
      const worker = role?.workerId ? store.workers.get(role.workerId) : undefined;
      const applied = (worker as (typeof worker & { autonomyApplied?: {mode:string; provider:string; detail:string} }))?.autonomyApplied;
      const saved = role?.autonomy ?? 'off';
      const confirmed = saved === 'off' || (role as (typeof role & {autonomyConfirmed?: boolean}))?.autonomyConfirmed === true;
      const savedLabel = confirmed ? saved : `${saved} (unconfirmed legacy preference; save to activate)`;
      span.textContent = applied ? `Launch policy: ${applied.detail} (${applied.provider}). Saved request: ${savedLabel}.${confirmed && applied.mode !== saved ? ' Current session unchanged; explicit replacement is needed to apply the new policy.' : ''}`
        : worker ? `Current session settings not reported. Saved request: ${savedLabel}; no runtime change confirmed.` : `Off shift. Saved request: ${savedLabel}; ${confirmed ? 'applied when a new session starts' : 'not applied until explicitly saved'}.`;
    }
  };
  const paint = () => {

    const parts: HTMLElement[] = [];
    const ceo = store.ceo.ceo;
    // --- the CEO ---------------------------------------------------------------------------
    let ceoBlock = sections.get('ceo');
    const newCeo = !ceoBlock || (!!ceo && ceoBlock.dataset.empty === 'true');
    if (newCeo) {
      ceoBlock?.remove();
      ceoBlock = h('section.dept', {}, h('h4', {}, '👔 CEO'));
      ceoBlock.dataset.empty = String(!ceo);
      if (!ceo) {
        ceoBlock.append(h('p.empty', {}, 'No CEO on this project yet. An office admin sets one up; from then on only its owner talks to it or edits it.'));
      } else {
        const w = ceo.workerId ? store.workers.get(ceo.workerId) : undefined;
        const ownerLine = ceo.owner ? `owner: ${ceo.owner}` : 'no owner configured — set AGENT_OFFICE_CEO_OWNER or have an admin designate one';
        ceoBlock.append(
          h('div.dept-row', {}, h('strong', {}, ceo.name), w ? h('span.dept-chip', { 'data-worker-status': 'ceo' }, w.status === 'needs_input' ? 'needs you' : w.status === 'done' ? 'turn ended' : w.status) : h('span.dept-chip', { 'data-worker-status':'ceo' }, 'off shift'), h('span.dept-meta', { 'data-ceo-owner':true }, ownerLine)),
          ceoActions(net),
          engineRow(net, saves, 'ceo', undefined, ceo, ceo.name),
          autonomyRow(net, saves, 'ceo', undefined, ceo.autonomy, ceo.name),
          // Ownership passes only by the current owner's delegation (admin bootstraps an unowned CEO).
          emailsRow('CEO owner', ceo.owner ? [ceo.owner] : [], 'Owner email', (emails, status, button) => saves.send({ t: 'ceo.set', name: ceo.name, owner: emails[0] ?? '' }, status, button, 'CEO owner')),
        );
      }
      sections.set('ceo', ceoBlock);
    }
    parts.push(ceoBlock!);
    // --- the managers ----------------------------------------------------------------------
    for (const d of store.departments.departments) {
      const scope = JSON.stringify([store.ceo.ceo?.owner, d.lead?.controllers, d.lead?.audience, d.lead?.custodian, d.lead?.provider, d.policy?.provider]);
      const existing = sections.get(d.id);
      if (existing && consentScopes.get(d.id) !== scope && d.lead) net.send({t:'role.subscription.get', department:d.id});
      consentScopes.set(d.id, scope);
      if (existing && (existing.dataset.empty !== 'true' || !d.lead)) { parts.push(existing); continue; }
      existing?.remove();
      const ask = askBox(net, d);
      const consent = d.lead ? roleSubscription(net, d.id) : undefined;
      if (consent) consentOffs.push(consent.close);
      qaBoxes.set(d.id, ask);
      const block = h(
        'section.dept',
        {},
        h('h4', {}, `🎖️ ${d.name} manager`),
        ...(d.lead
          ? [
              h('div.dept-row', {}, h('strong', {}, d.lead.name), h('span.dept-meta', {}, `named by ${d.lead.by} · ${timeAgo(d.lead.at)}`)),
              ...(d.lead.objective ? [h('p.dept-hint', {}, `Objective: ${d.lead.objective.text}`)] : []),
              engineRow(net, saves, 'dept', d.id, d.lead, d.lead.name),
              autonomyRow(net, saves, 'dept', d.id, d.lead.autonomy, d.lead.name),
              emailsRow('Controllers', d.lead.controllers, 'ivanv@…, eduardo@…', (emails, status, button) => saves.send({ t: 'departments.access', id: d.id, controllers: emails }, status, button, 'Controllers')),
              emailsRow('Q&A audience', d.lead.audience, 'empty = any signed-in colleague', (emails, status, button) => saves.send({ t: 'departments.access', id: d.id, audience: emails }, status, button, 'Q&A audience')),
              emailsRow('Custodian', d.lead.custodian ? [d.lead.custodian] : [], 'Billing custodian email', (emails, status, button) => saves.send({ t: 'departments.access', id: d.id, custodian: emails[0] ?? '' }, status, button, 'Custodian')),
              consent!.element,
              ask.element,
            ]
          : [h('p.empty', {}, 'No manager named yet.')]),
      );
      block.dataset.empty = String(!d.lead);
      sections.set(d.id, block); parts.push(block);
    }
    for (const part of parts) if (part.parentElement !== list) { if (part === ceoBlock) list.prepend(part); else list.append(part); }
    runtime();
    for (const span of list.querySelectorAll<HTMLElement>('[data-role-engine]')) {
      const id = span.dataset.roleEngine!;
      const role = id === 'ceo' ? store.ceo.ceo : store.departments.departments.find(d => d.id === id)?.lead;
      span.textContent = `Saved engine: ${role?.provider ? choiceLabel(prefill(role)) : choiceLabel(officeChoice(store.project))}`;
    }
  };

  const onMessage = (msg: import('../../shared/protocol').ServerMsg) => {
    if (msg.t === 'departments.qa') {
      const box = qaBoxes.get(msg.id);
      box?.receive(msg);
    }
  };
  const offs = [net.onMessage(onMessage), net.onStatus(up => qaBoxes.forEach(box => box.disconnected(up))), store.on('departments', paint), store.on('ceo', paint), store.on('workers', runtime)];
  const modal = openModal(el, { doing: '🛡️ reviewing roles', onClose: () => { saves.close(); offs.forEach((o) => o()); consentOffs.splice(0).forEach(off => off()); } });
  close.addEventListener('click', () => modal.close());
  offs.push(store.on('floor', () => modal.close()));
  paint();
}
