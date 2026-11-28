import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, openModal, toast, type Modal } from '../../ui/dom';
import './connection.css';
interface LinkState {
  projects?: { name: string; status?: string }[];
  pending: { id: string; computerName: string; expiresAt: number }[];
  links: { id: string; computerName: string; connected: boolean; lastSeen: number }[];
}
// Capture before the app shell consumes its navigation query.
let incomingApproval = new URL(location.href).searchParams.get('link');
let active: Modal | undefined;
async function state(): Promise<LinkState> {
  const response = await fetch('/api/mac-link', { cache: 'no-store' });
  if (!response.ok) throw Error('Mac link controls are available only to the HQ owner');
  return response.json();
}
function openLinks(initial: LinkState, approval?: string) {
  active?.close();
  const body = h('div.body'), account = store.me.account?.name;
  const modal = h('div.modal.hq-connect', { role: 'dialog', 'aria-label': approval ? 'Approve Mac link' : 'Mac link' },
    h('header', {}, h('h2', {}, approval ? 'Approve Mac link' : 'Mac link')), body);
  let closed = false, loading = false, off = () => {};
  const window = openModal(modal, { onClose: () => { closed = true; clearInterval(timer); off(); } }); active = window;
  const act = async (id: string, action: string) => {
    if (closed || loading) return; loading = true;
    try {
      const response = await fetch('/api/mac-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }) });
      if (!response.ok) throw Error('Link or pairing unavailable');
      approval = undefined; modal.querySelector('h2')!.textContent = 'Mac link'; modal.setAttribute('aria-label', 'Mac link'); const next = await state(); if (!closed) paint(next);
      toast(action === 'approve' ? 'Mac link approved' : action === 'deny' ? 'Mac link denied' : 'Mac link revoked');
    } catch (e) { toast((e as Error).message); } finally { loading = false; }
  };
  const paint = (data: LinkState) => {
    body.replaceChildren(h('p', {}, 'Link your Mac: run this command on it.'), h('code.cb-cmd', {}, `agent-office link ${location.origin}`));
    for (const p of data.pending.filter(p => !approval || p.id === approval)) {
      body.append(h('section.hq-link-request', {}, h('h3', {}, `Link ${p.computerName} to your office?`),
        h('p', {}, `Expires ${new Date(p.expiresAt).toLocaleTimeString()}`),
        h('div.hq-link-actions', {}, h('button.btn', { onclick: () => void act(p.id, 'approve') }, 'Approve'), h('button.btn', { onclick: () => void act(p.id, 'deny') }, 'Deny'))));
    }
    if (approval && !data.pending.some(p => p.id === approval)) body.append(h('p', {}, 'This pairing has expired or was already decided.'));
    for (const project of data.projects ?? []) if (project.status) body.append(h('p', {}, `${project.name} · ${project.status}`));
    for (const link of data.links) body.append(h('section.hq-link-record', {}, h('h3', {}, link.computerName),
      h('p', {}, link.connected ? 'Connected' : `Offline since ${new Date(link.lastSeen).toLocaleString()}`),
      // The office can't see why a Mac is away; an expired Cloudflare sign-in is the usual reason, and the Mac can't report it past Access.
      ...(link.connected ? [] : [h('p.note', {}, 'Mac link needs sign-in? If it stays offline, run ', h('code', {}, `cloudflared access login ${location.origin}`), ' on that Mac.')]),
      h('button.btn', { onclick: () => void act(link.id, 'revoke') }, 'Revoke')));
  };
  const refresh = async () => {
    if (closed || loading) return;
    try { const next = await state(); if (!closed) paint(next); } catch { if (!closed) window.close(); }
  };
  const timer = setInterval(() => void refresh(), 5000);
  off = store.on('me', () => { if (account && store.me.account?.name !== account) window.close(); });
  paint(initial);
}
export function connectMac(_ctx: Ctx) {
  if (!store.hq?.mine || store.hq.floorId !== store.floor) return;
  const account = store.me.account?.name, floor = store.floor;
  void state().then(s => { if (store.hq?.mine && store.floor === floor && store.me.account?.name === account) openLinks(s); }).catch(e => toast((e as Error).message));
}
/** The approval URL contains only an uncredentialed request id; the server checks the account. */
export function wireMacConnection(_ctx: Ctx) {
  const url = new URL(location.href), approval = url.searchParams.get('link') ?? incomingApproval;
  incomingApproval = null;
  if (!approval || !/^[a-f0-9]{48}$/.test(approval)) return;
  url.searchParams.delete('link'); history.replaceState(null, '', url);
  const open = () => { const account = store.me.account?.name; void state().then(s => { if (store.me.account?.name === account) openLinks(s, approval); }).catch(e => toast((e as Error).message)); };
  if (store.floor) open();
  else { const off = store.on('floor', () => { if (store.floor) { off(); open(); } }); }
}
