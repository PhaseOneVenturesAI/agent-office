import './hygiene.css';
import type { HygieneFloor } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

const row = (left: string | HTMLElement, right?: HTMLElement) => h('div.hyg-row', {}, typeof left === 'string' ? h('span.hyg-what', {}, left) : left, h('span.grow'), right ?? '');

/** One floor's findings: unpushed work, stale worktrees (prunable), strays, idle workers. */
function floorCard(net: Net, f: HygieneFloor, admin: boolean) {
  const findings = f.unpushed.length + f.stale.length + f.strays.length + f.idle.length;
  const card = h('article.hyg-floor', {}, h('h3', {}, f.name, findings ? h('span.hyg-count', {}, String(findings)) : h('span.hyg-clean', {}, ' ✓ clean')));
  if (f.error) card.append(h('p.hyg-warn', {}, `⚠️ couldn't scan: ${f.error}`));
  for (const u of f.unpushed) {
    card.append(row(u.commits < 0 ? `⚠️ ${u.branch}` : `🚨 ${u.branch} — ${u.commits} commit${u.commits === 1 ? '' : 's'} no remote has`));
  }
  if (f.stale.length) {
    const prune = h('button.btn.small', { type: 'button', title: 'Remove these worktrees — only ones holding no uncommitted or unpushed work go' }, `Prune ${f.stale.length}`) as HTMLButtonElement;
    prune.disabled = !admin;
    prune.addEventListener('click', () => net.send({ t: 'hygiene.prune', floor: f.id }));
    card.append(h('h4', {}, `Stale worktrees (${f.stale.length})`, h('span.grow'), prune));
    for (const s of f.stale) card.append(row(`🗑 ${s.path}${s.branch ? ` · ${s.branch}` : ''}`));
  }
  if (f.strays.length) {
    card.append(h('h4', {}, `Leftover folders (${f.strays.length})`));
    for (const s of f.strays) card.append(row(`📁 ${s} — not tracked by git; check by hand`));
  }
  if (f.idle.length) {
    card.append(h('h4', {}, `Landed but still at a desk (${f.idle.length})`));
    for (const i of f.idle) {
      const home = h('button.btn.small', { type: 'button', title: 'Send it home — its worktree and branch go too unless they hold work' }, '🏠 Send home') as HTMLButtonElement;
      home.disabled = !admin;
      home.addEventListener('click', () => net.send({ t: 'hygiene.home', floor: f.id, worker: i.id }));
      card.append(row(`${i.name} — ${i.why}`, home));
    }
  }
  return card;
}

/**
 * 🧹 Hygiene: the mess that regrows in a busy office, on one wall — commits no remote has,
 * worktrees nobody sits in, merged workers who never went home — with one-click cleanup for
 * admins. Scans by itself every six hours; **Scan now** for right now (see server/hygiene.ts).
 */
export function openHygiene(net: Net) {
  const list = h('div.hyg-list');
  const status = h('span.hyg-status');
  const scan = h('button.btn.small', { type: 'button' }, '↻ Scan now');
  scan.addEventListener('click', () => net.send({ t: 'hygiene.scan' }));
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.hygiene',
    { role: 'dialog', 'aria-label': 'Hygiene' },
    h('header', {}, h('h2', {}, '🧹 Hygiene'), close),
    h('div.hyg-head', {}, status, h('span.grow'), scan),
    list,
  );

  const repaint = () => {
    if (!el.isConnected) return;
    const s = store.hygiene;
    status.textContent = s.scanning ? 'Scanning…' : s.scannedAt ? `Scanned ${timeAgo(s.scannedAt)}` : 'Not scanned yet';
    list.replaceChildren();
    if (!s.floors.length) list.append(h('p.empty', {}, s.scanning ? 'Scanning the floors…' : 'Nothing to report yet.'));
    for (const f of s.floors) list.append(floorCard(net, f, store.me.admin));
  };

  const offMe = store.on('me', repaint);
  const off = store.on('hygiene', repaint);
  const modal = openModal(el, {
    doing: '🧹 reading the hygiene report',
    onClose: () => {
      offMe();
      off();
    },
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'hygiene.get' });
  repaint();
}
