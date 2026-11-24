import './nodes.css';
import type { NodeInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { PROVIDER_LABEL } from './provider';

function spec(n: NodeInfo): string {
  if (!n.host && !n.platform) return 'hasn’t said hello yet';
  const mem = n.memGB ? ` · ${n.memGB} GB` : '';
  const cpus = n.cpus ? ` · ${n.cpus} cpus` : '';
  return `${n.platform}${cpus}${mem}${n.version ? ` · agent-office ${n.version}` : ''}`;
}

/** One machine: its status, what it is, the agents it could run, and when it was last here. */
function card(net: Net, n: NodeInfo, admin: boolean) {
  const el = h(
    'article.nd-node',
    {},
    h(
      'h3',
      {},
      h(`span.nd-dot.${n.online ? 'on' : 'off'}`, { title: n.online ? 'online now' : 'offline' }),
      n.name,
      n.host && n.host !== n.name ? h('span.nd-host', {}, ` · ${n.host}`) : '',
      h('span.grow'),
      h('span.nd-seen', {}, n.online ? 'online' : n.lastSeen ? `seen ${timeAgo(n.lastSeen)}` : 'never here'),
    ),
    h('p.nd-spec', {}, spec(n)),
  );
  if (n.providers.length) {
    el.append(h('div.nd-providers', {}, ...n.providers.map((p) => h('span.nd-chip', {}, PROVIDER_LABEL[p] ?? p))));
  } else if (n.host) {
    el.append(h('p.nd-spec', {}, 'no agent CLIs on its PATH'));
  }
  if (admin) {
    const revoke = h('button.btn.small', { type: 'button', title: 'Take this machine off the office — its join token stops working' }, 'Remove');
    revoke.addEventListener('click', () => {
      if (confirm(`Remove ${n.name} from the office? Its join token stops working.`)) net.send({ t: 'nodes.revoke', id: n.id });
    });
    el.append(h('div.nd-actions', {}, revoke));
  }
  return el;
}

/** The join command for a fresh token, with a copy button; the token is never shown again. */
function inviteBox(origin: string, name: string, token: string) {
  const command = `agent-office join ${origin} --token ${token}`;
  const copy = h('button.btn.small', { type: 'button' }, 'Copy');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(command);
    copy.textContent = '✓ Copied';
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
  return h(
    'div.nd-invite',
    {},
    h('p', {}, `🎟 ${name} is invited. Run this on the machine, and leave it running:`),
    h('div.nd-command', {}, h('code', {}, command), copy),
    h('p.nd-once', {}, 'The token is shown only now — the office keeps its hash. Lose it and the machine simply gets a new invite.'),
  );
}

/**
 * 🛰️ Satellites: the team's own computers, joined with `agent-office join`, on one wall — who's
 * here, what each machine could run, and who's gone quiet. Admins mint join tokens here (see
 * server/nodes.ts).
 */
export function openNodes(net: Net) {
  const list = h('div.nd-list');
  const inviteSlot = h('div');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.nodes',
    { role: 'dialog', 'aria-label': 'Satellites' },
    h('header', {}, h('h2', {}, '🛰️ Satellites'), close),
    h('span.nd-status', {}, 'Joined computers and their installed agent CLIs. Installed CLIs do not establish account readiness.'),
    inviteSlot,
    list,
  );

  const repaint = () => {
    if (!el.isConnected) return;
    list.replaceChildren();
    if (store.me.admin) {
      const invite = h('button.btn.small', { type: 'button' }, '🎟 Invite a machine');
      invite.addEventListener('click', () => {
        const name = prompt('A name for the machine (optional — its hostname works too):') ?? '';
        net.send({ t: 'nodes.invite', ...(name.trim() ? { name: name.trim() } : {}) });
      });
      list.append(h('div.nd-actions', {}, invite));
    }
    if (!store.nodes.nodes.length) list.append(h('p.empty', {}, 'No machines joined yet. Invite one, and run the command on it.'));
    for (const n of store.nodes.nodes) list.append(card(net, n, store.me.admin));
  };

  // The join token answers only the admin who asked; it lands here, once.
  const offMessage = net.onMessage((m) => {
    if (el.isConnected && m.t === 'nodes.token') inviteSlot.replaceChildren(inviteBox(location.origin, m.name, m.token));
  });
  const offMe = store.on('me', repaint);
  const off = store.on('nodes', repaint);
  const floorOff = store.on('floor', () => { net.send({ t: 'nodes.get' }); repaint(); });
  const timer = setInterval(repaint, 30_000);
  const modal = openModal(el, {
    doing: '🛰️ looking at the satellites',
    onClose: () => {
      offMe();
      offMessage();
      floorOff();
      clearInterval(timer);
      off();
    },
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'nodes.get' });
  repaint();
}
