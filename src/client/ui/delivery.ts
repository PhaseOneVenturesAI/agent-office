import './delivery.css';
import type { DeliveryState } from '../../shared/protocol/delivery';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast } from './dom';

/** Shared by the 3D and lite PR/queue views. Observes existing runs; never starts CI. */
export function openDelivery(net: Net, number: number) {
  let state: DeliveryState | undefined;
  let disconnected = !net.up;
  const body = h('div.delivery-body', {}, h('p', {}, 'Reading existing GitHub runs…'));
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const refresh = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'delivery.refresh' }) }, 'Refresh evidence');
  const el = h('div.modal.delivery', { role: 'dialog', 'aria-label': `CI evidence for PR #${number}` },
    h('header', {}, h('h2', {}, `CI evidence · PR #${number}`), close), body,
    h('footer', {}, refresh, h('span', {}, 'Shared reads · at most once a minute')),
  );
  function render() {
    if (!state) return;
    refresh.disabled = disconnected || state.loading;
    body.replaceChildren(h('div', {},
      h('p', {}, state.repo), h('code.delivery-sha', {}, state.sourceSha),
      h('p', {}, disconnected ? 'Disconnected · evidence may be stale; reopen after reconnecting.' : state.loading ? 'Refreshing existing runs…' : state.fetchedAt ? `Read ${timeAgo(state.fetchedAt)}` : 'No successful read yet'),
      h('p.delivery-note', {}, 'Run head metadata matches. Checkout, target and configuration remain unverified. This is not release evidence.'),
      state.error ? h('p.delivery-note', { role: 'status' }, state.error) : null,
      !state.runs.length ? h('p', {}, 'No matching run evidence is available. No CI was started.') : null,
      ...state.runs.map((r) => {
        const watcher = r.watcher && r.watcher.expiresAt > Date.now() ? r.watcher : undefined;
        return h('article.delivery-run', {},
          h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `${r.workflow} · run ${r.id} · attempt ${r.attempt} ↗`),
          h('p', {}, `${r.status.replaceAll('_', ' ')}${r.conclusion ? ` · ${r.conclusion}` : ''} · ${r.event.replaceAll('_', ' ')}`),
          h('p', {}, 'Configuration association incomplete · reuse only this identified run'),
          h('p', {}, watcher ? `${watcher.name} watches this run${watcher.mine ? ' (you)' : ''} · lease ends ${new Date(watcher.expiresAt).toLocaleTimeString()}` : 'Watcher unassigned'),
          h('button.btn', { type: 'button', disabled: disconnected || r.status === 'completed' || (!!watcher && !watcher.mine), onclick: () => net.send({ t: watcher?.mine ? 'delivery.release' : 'delivery.watch', runKey: r.key }) }, r.status === 'completed' ? 'Completed · reuse evidence' : watcher?.mine ? 'Stop watching' : watcher ? 'Reusing shared watcher' : 'Watch this run'),
        );
      }),
      h('p.delivery-help', {}, 'Watching keeps one shared reader active while this panel stays open. Other viewers reuse it. Closing releases your watch; agents outside Office are not controlled.'),
    ));
  }
  const off = net.onMessage((m) => {
    if (m.t !== 'delivery.state' || m.state.number !== number) return;
    for (const r of m.state.runs) if (r.status === 'completed' && state?.runs.some((old) => old.key === r.key && old.watcher?.mine && old.status !== 'completed')) toast(`${r.workflow} run ${r.id}: ${r.conclusion ?? 'completed'}`);
    state = m.state; render();
  });
  const statusOff = net.onStatus((up) => { disconnected = !up; render(); });
  const renew = setInterval(() => {
    for (const run of state?.runs ?? []) if (run.watcher?.mine && run.watcher.expiresAt > Date.now()) net.send({ t: 'delivery.renew', runKey: run.key });
    render();
  }, 30_000);
  const modal = openModal(el, { onClose: () => { off(); statusOff(); floorOff(); clearInterval(renew); net.send({ t: 'delivery.close' }); } });
  const floorOff = store.on('floor', () => modal.close());
  close.onclick = () => modal.close();
  net.send({ t: 'delivery.open', number });
}
