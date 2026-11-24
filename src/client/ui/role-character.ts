import './departments.css';
import './role-character.css';
import type { RolePresence } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { askBox } from './role-ask';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openTerminal } from './terminal';
import { openWorkerConversation } from './worker-conversation';

/** A role key never grants authority: ask the server before choosing the character's front door. */
export function openRoleCharacter(net: Net, key: string) {
  const floor = store.floor;
  if (!floor) return;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const title = h('h2', {}, 'Talk');
  const body = h('div.role-character-body', {}, h('p.dept-hint', {}, 'Checking access…'));
  const el = h('div.modal.dept-chooser.role-character', { role: 'dialog', 'aria-label': 'Talk to character' }, h('header', {}, title, close), body);
  let requestId = '', alive = true, started = false, painted = '';
  let ask: ReturnType<typeof askBox> | undefined;
  const refresh = () => {
    if (!alive || !net.up || store.floor !== floor) return;
    requestId = crypto.randomUUID(); net.send({ t: 'role.presence.get', requestId });
  };
  const paint = (role: RolePresence) => {
    const signature = JSON.stringify(role);
    if (signature === painted) return;
    painted = signature;
    title.textContent = `${role.name} · ${role.title}`;
    el.setAttribute('aria-label', `Talk to ${role.name}`);
    if (role.talk && role.workerId && store.workers.has(role.workerId)) {
      modal.close();
      openWorkerConversation(net, role.workerId, () => openTerminal(net, role.workerId!));
      return;
    }
    ask = undefined; body.replaceChildren();
    const dept = role.department ? store.departments.departments.find(d => d.id === role.department) : undefined;
    if (!role.workerId) body.append(h('p.dept-hint', {}, started ? 'Starting shift…' : 'Off shift'));
    if (role.reason) body.append(h('p.dept-hint', { role: 'status' }, role.reason));
    if (role.start) {
      const saved = dept?.policy ?? dept?.lead ?? store.ceo.ceo;
      const choice = saved?.provider ? { provider: saved.provider, model: saved.model, effort: saved.effort } : officeChoice(store.project);
      const picker = dept?.policy?.mode === 'ask' ? agentFields(store.project, `character-${key}`, choice) : undefined;
      const start = h('button.btn.primary', { type: 'button', disabled: started || !net.up }, 'Start shift');
      body.append(h('p.dept-engine', {}, choiceLabel(choice)), ...(picker ? [picker.element] : []), start);
      start.onclick = () => {
        if (!net.up || started || (picker && !picker.valid())) return;
        const engine = picker ? { provider: picker.value(), model: picker.model(), effort: picker.effort() } : choice;
        started = true; start.disabled = true; start.textContent = 'Starting…';
        net.send(dept ? { t: 'departments.lead.launch', id: dept.id, ...engine } : { t: 'ceo.launch', ...engine });
      };
    }
    if (role.ask && dept) {
      ask = askBox(net, dept);
      body.append(h('p.dept-hint', {}, 'Ask a read-only question'), ask.element);
    }
    if (!role.start && !role.ask && !role.reason) body.append(h('p.dept-hint', {}, 'This character is unavailable.'));
  };
  const offs = [
    net.onMessage(msg => {
      if (msg.t === 'role.presence' && msg.floor === floor && msg.requestId === requestId) {
        const role = msg.roles.find(r => r.key === key);
        if (role) paint(role); else body.replaceChildren(h('p.dept-hint', {}, msg.error ?? 'This character is no longer on this floor.'));
      }
      if (msg.t === 'departments.qa') ask?.receive(msg);
      if (msg.t === 'toast' && msg.level !== 'info' && started) { started = false; painted = ''; refresh(); }
    }),
    net.onStatus(up => {
      ask?.disconnected(up);
      if (up) { started = false; painted = ''; refresh(); }
      else body.querySelectorAll('button').forEach(b => b.disabled = true);
    }),
    store.on('floor', () => { if (store.floor !== floor) modal.close(); }),
    store.on('ceo', refresh), store.on('departments', refresh),
    store.on('workers', () => { if (started) refresh(); }),
  ];
  const modal = openModal(el, { doing: '💬 talking to a character', onClose: () => { alive = false; offs.forEach(off => off()); } });
  close.onclick = () => modal.close();
  refresh();
}

export function roleKeyForWorker(id: string): string | undefined {
  if (store.ceo.ceo?.workerId === id) return 'ceo';
  const dept = store.departments.departments.find(d => d.lead?.workerId === id);
  return dept ? `manager:${dept.id}` : undefined;
}
