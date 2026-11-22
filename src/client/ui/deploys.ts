import './deploys.css';
import type { DeployItem } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

/** One deployment: its kind, name, link, age, and the button that stages it for a verdict. */
function deployRow(net: Net, item: DeployItem) {
  const stage = h(
    'button.btn.small',
    { type: 'button', title: item.url ? 'Put it in the 🎬 Review room for a verdict' : 'No public URL to look at' },
    '🎬 Stage for review',
  ) as HTMLButtonElement;
  stage.disabled = !item.url;
  stage.addEventListener('click', () => net.send({ t: 'deploys.stage', id: item.id }));
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
    stage,
  );
}

/**
 * 🚀 Deploy board: the office's Cloudflare Pages and Workers projects. What changed when, a link
 * to look at, and one click to stage any of them in the Review room — the bridge between "the
 * agents made it" and "a person approved it" (see server/deploys.ts).
 */
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
          h('p', {}, 'Connect Cloudflare and every Pages and Workers project of the account lands here, each one click from the 🎬 Review room.'),
          h('p', {}, 'On the server, set two environment variables and restart the office:'),
          h('pre', {}, 'AGENT_OFFICE_CF_ACCOUNT_ID=<the account id>\nAGENT_OFFICE_CF_API_TOKEN=<a read-only API token>'),
          h('p.dim', {}, 'The token never leaves the server; the board is read-only.'),
        ),
      );
      return;
    }
    status.textContent = s.error ? `⚠️ ${s.error}` : s.fetchedAt ? `Fetched ${timeAgo(s.fetchedAt)}` : 'Fetching…';
    if (!s.items.length && !s.error) list.append(h('p.empty', {}, 'No Pages projects or Workers on this account yet.'));
    for (const item of s.items) list.append(deployRow(net, item));
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
