import './settings-my-agents.css';
import type { Net } from '../net';
import type { PersonalAutonomyState } from '../../shared/protocol';
import { h } from './dom';

/** Account-owned server setting; deliberately separate from the office-wide Workers defaults. */
export function myAgentsSetting(net: Net) {
  const toggle = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Automatic approvals for my agents', disabled: true }) as HTMLInputElement;
  const note = h('p.setting-note', {}, 'Applies to your current and future personal agents. Explicit role settings take priority. Other custodians and read-only staff Q&A keep their settings.');
  const status = h('p.setting-note', { role: 'status', 'aria-live': 'polite' }, 'Loading your preference…');
  const refresh = h('button.btn.small', { type: 'button' }, 'Refresh status') as HTMLButtonElement;
  const list = h('ul.my-agents-list');
  const section = h('div.setting.my-agents', {},
    h('div.setting-head', {}, h('h4', {}, 'Automatic approvals'), h('span.scope.you', { title: 'Saved to your account on this office' }, 'Your account')),
    h('label.my-agents-switch', {}, toggle, h('span', {}, 'Let my agents use automatic review')),
    note, status, refresh, list,
  );
  let requestId = '', pending = false, state: PersonalAutonomyState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const paint = () => {
    toggle.checked = state?.automatic ?? false; toggle.disabled = !net.up || !state || pending;
    refresh.disabled = !net.up || pending;
    list.replaceChildren(...(state?.workers ?? []).map(worker => h('li', {},
      h('div.my-agents-name', {}, h('strong', {}, worker.name), h('span', {}, `${worker.floor} · ${worker.provider}`)),
      h('span.my-agents-status', { 'data-autonomy-status': worker.status }, ({ applied: 'Confirmed', pending: 'Pending', launch: 'Requested at launch', override: 'Role override', unavailable: 'Unchanged' })[worker.status]),
      h('p.setting-note', {}, worker.detail),
      ...(worker.roleOverride && worker.status !== 'override' ? [h('p.setting-note', {}, 'This role has its own saved setting.')] : []),
      ...(worker.pendingApproval ? [h('p.setting-note', {}, 'An existing approval still needs a choice in this agent’s Conversation.')] : []),
    )));
    if (state && !state.workers.length) list.append(h('li', {}, 'No personal agents are seated. Your choice will apply when you start one.'));
  };
  const start = (saving: boolean) => {
    requestId = crypto.randomUUID(); pending = true; clearTimeout(timer);
    status.textContent = saving ? 'Saving your preference and checking current sessions…' : 'Checking your agents…';
    timer = setTimeout(() => { pending = false; status.textContent = 'The result is not confirmed. Refresh status before trying again.'; paint(); }, 35_000);
  };
  const load = () => { if (!net.up) return; start(false); paint(); net.send({ t: 'personal.autonomy.get', requestId }); };
  toggle.addEventListener('change', () => {
    const automatic = toggle.checked; start(true); paint();
    net.send({ t: 'personal.autonomy.set', requestId, automatic });
  });
  refresh.addEventListener('click', load);
  const offMessage = net.onMessage(msg => {
    if (msg.t !== 'personal.autonomy.state' || (msg.requestId && msg.requestId !== requestId) || (!msg.requestId && pending)) return;
    clearTimeout(timer); pending = false; state = msg.state;
    status.textContent = msg.error ?? (state?.configured ? `Saved: ${state.automatic ? 'automatic review' : 'manual approvals'}. Current sessions are shown below; active work is kept.` : 'No personal default saved yet. Choose automatic review to apply it to your agents.');
    paint();
  });
  const offStatus = net.onStatus(up => { if (up) load(); else { clearTimeout(timer); pending = false; status.textContent = 'Disconnected. Your saved preference has not changed.'; paint(); } });
  load();
  return { section, close() { clearTimeout(timer); offMessage(); offStatus(); } };
}
