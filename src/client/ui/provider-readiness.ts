import type { Net } from '../net';
import { h } from './dom';

/** Readiness lives beside the existing account controls, scoped to the person and current floor. */
export function readinessPanel(net: Net) {
  const body = h('div');
  const refresh = h('button.btn', { type: 'button' }, 'Check readiness');
  const el = h('details', {}, h('summary', {}, 'Provider readiness'), h('p.note', {}, 'This Office host and your workers on this floor. No automatic provider or model changes.'), refresh, body);
  let alive = true;
  const off = net.onMessage((msg) => {
    if (!alive || msg.t !== 'readiness') return;
    refresh.removeAttribute('disabled');
    body.replaceChildren(...msg.providers.map((p) => h('section', {},
      h('h4', {}, `${p.provider === 'github' ? 'GitHub' : p.provider[0].toUpperCase() + p.provider.slice(1)} · CLI ${p.installed ? 'available' : 'missing'}`),
      h('p.note', {}, `${p.auth === 'configured' ? 'Credentials configured' : p.auth === 'checking' ? 'Checking sign-in' : 'Sign-in needed'}. ${p.evidence}`),
      ...p.models.map((m) => h('p.note', {}, `${m.worker}: selected ${m.selected ?? 'provider default'}; last reported ${m.reported ?? 'unknown'}.`)),
      h('p.note', {}, `Remaining quota: unknown. Checked ${new Date(p.checkedAt).toLocaleTimeString()}.`))));
  });
  refresh.addEventListener('click', () => { body.textContent = 'Checking…'; net.send({ t: 'readiness.get' }); });
  return { el, drop() { alive = false; off(); } };
}
