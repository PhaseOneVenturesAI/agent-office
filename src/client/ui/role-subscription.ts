import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
/** Consent is confirmed by server state, never an optimistic toggle. */
export function roleSubscription(net: Net, department: string) {
  const floor = store.floor;
  const el = h('div.dept-lead-form', {}, h('p.dept-hint', {}, 'Checking subscription consent…'));
  const off = net.onMessage(msg => {
    if (msg.t !== 'role.subscription.state' || msg.state.floor !== floor || msg.state.department !== department) return;
    const s = msg.state;
    const detail = h('p.dept-hint', {}, `${s.project} / ${s.departmentName} · ${s.provider}. Payer: ${s.custodian ?? 'not designated'}.`);
    const people = h('p.dept-hint', {}, `Controllers allowed to use this subscription: ${s.controllers.join(', ') || 'none'}.`);
    const status = h('p.dept-hint', { role: 'status' }, msg.error ?? (s.active ? 'Subscription consent active.' : s.reason ?? 'Subscription consent pending.'));
    const qa = h('input', { type: 'checkbox', 'aria-label': 'Allow paid read-only staff Q&A' });
    qa.checked = s.allowStaffQA;
    qa.disabled = !s.canConsent || s.active;
    const qaLabel = h('label.dept-hint', {}, qa, ` Also allow paid read-only Q&A for ${s.audience.length ? s.audience.join(', ') : 'all signed-in colleagues'}. This uses a separate session, never the manager’s conversation.`);
    const button = h('button.btn.small', { type: 'button' }, s.active ? 'Revoke shared subscription use' : 'Allow these controllers to use my subscription');
    button.disabled = !s.canConsent || !net.up;
    button.addEventListener('click', () => {
      button.disabled = true;
      status.textContent = 'Saving consent…';
      net.send({ t: 'role.subscription.set', department, configuration: s.configuration, allow: !s.active, allowStaffQA: qa.checked });
    });
    el.replaceChildren(h('strong', {}, 'Subscription consent'), detail, people, status,
      h('p.dept-hint', {}, 'Permits paid turns and tool actions for this manager AND its department child workers on this provider, under the payer’s connected account. Other providers need separate consent. Personal defaults stay unchanged. Revocation blocks future shared actions; an already running turn is not automatically stopped.'),
      qaLabel, button, h('p.dept-hint', {}, s.canConsent ? 'Only you can grant use of your subscription. Review every named controller above.' : 'The named custodian must sign in to approve their own subscription.'));
  });
  const offStatus = net.onStatus(up => {
    if (up) net.send({ t: 'role.subscription.get', department });
    else { el.querySelectorAll('button').forEach(b => b.disabled = true); const status = el.querySelector('[role=status]'); if (status) status.textContent = 'Disconnected. Reconnect to confirm consent.'; }
  });
  net.send({ t: 'role.subscription.get', department });
  return { element: el, close: () => { off(); offStatus(); } };
}
