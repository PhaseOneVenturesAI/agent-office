import './deploys.css';
import type { DeployItem } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

/** One deployment: its kind, name, link and age. */
function deployRow(item: DeployItem) {
  return h(
    'article.deploy-row',
    {},
    h('span.deploy-kind', { class: item.kind }, item.kind === 'pages' ? 'Pages' : 'Worker'),
    h(
      'div.deploy-main',
      {},
      h('strong', {}, item.name),
      h(
        'span.deploy-meta',
        {},
        [item.meta, item.updatedAt ? `updated ${timeAgo(item.updatedAt)}` : ''].filter(Boolean).join(' · '),
      ),
    ),
    item.url ? h('a.deploy-link', { href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url }, 'open ↗') : null,
  );
}

/** Read-only Cloudflare Pages and Workers project list. */
export function openDeploys(net: Net) {
  const list = h('div.deploy-list');
  const status = h('span.deploy-status');
  const refresh = h('button.btn.small', { type: 'button', title: 'Fetch the projects from Cloudflare again' }, '↻ Refresh') as HTMLButtonElement;
  refresh.addEventListener('click', () => {
    refresh.disabled = true;
    setTimeout(() => (refresh.disabled = false), 3000);
    net.send({ t: 'deploys.refresh' });
  });
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.deploys',
    { role: 'dialog', 'aria-label': 'Deploy board' },
    h('header', {}, h('h2', {}, '🚀 Deploy board'), close),
    h('div.deploy-head', {}, status, h('span.grow'), refresh),
    list,
  );

  const repaint = () => {
    if (!el.isConnected) return;
    const s = store.deploys;
    list.replaceChildren();
    if (!s.configured) {
      status.textContent = '';
      list.append(
        h(
          'div.deploy-connect',
          {},
          h('p', {}, 'Connect Cloudflare to list the account’s Pages and Workers projects here.'),
          h('p', {}, 'On the server, set two environment variables and restart the office:'),
          h('pre', {}, 'AGENT_OFFICE_CF_ACCOUNT_ID=<the account id>\nAGENT_OFFICE_CF_API_TOKEN=<a read-only API token>'),
          h('p.dim', {}, 'The token never leaves the server; the board is read-only.'),
        ),
      );
      return;
    }
    status.textContent = s.error ? `⚠️ ${s.error}` : s.fetchedAt ? `Fetched ${timeAgo(s.fetchedAt)}` : 'Fetching…';
    if (!s.items.length && !s.error) list.append(h('p.empty', {}, 'No Pages projects or Workers on this account yet.'));
    for (const item of s.items) list.append(deployRow(item));
  };

  const off = store.on('deploys', repaint);
  const modal = openModal(el, {
    doing: '🚀 looking over the deployments',
    onClose: () => off(),
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'deploys.get' });
  repaint();
}
