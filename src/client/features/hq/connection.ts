import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, openModal, toast, type Modal } from '../../ui/dom';
import { ownerDeviceKey, displayFingerprint } from '../../shared/cubby/keys';
import '../../shared/cubby/chat.css';
import './connection.css';
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export function connectMac(ctx: Ctx) {
  const account = store.me.account?.name, floor = store.floor;
  if (!store.hq?.mine || store.hq.floorId !== floor) return;
  void ownerDeviceKey(account).then(() => {
    if (store.hq?.mine && store.floor === floor && store.me.account?.name === account) ctx.net.send({ t: 'hq.setup' });
  }).catch(e => toast((e as Error).message));
}
export function wireMacConnection(ctx: Ctx) {
  let active: Modal | undefined;
  ctx.messages.on('hq.token', msg => {
    if (!store.hq?.mine || store.hq.floorId !== msg.floorId || store.floor !== msg.floorId) return;
    active?.close();
    const account = store.me.account?.name;
    const code = h('code.cb-cmd'), fingerprint = h('p', {}, 'Preparing owner key…');
    const copy = h('button.btn', { type: 'button', disabled: true }, 'Copy command');
    const body = h('div.body', {}, h('p', {}, 'Run this on your Mac and leave it running. HQ receives every registered local project.'), code, copy, fingerprint);
    const modal = h('div.modal.hq-connect', { role: 'dialog', 'aria-label': 'Connect your Mac' }, h('header', {}, h('h2', {}, 'Connect your Mac')), body);
    let off = () => {};
    const window = openModal(modal, { onClose: () => off() });
    active = window;
    const check = () => { if (!store.hq?.mine || store.floor !== msg.floorId || store.me.account?.name !== account) window.close(); };
    const subscriptions = [store.on('hq', check), store.on('me', check), store.on('floor', check)];
    off = () => subscriptions.forEach(stop => stop());
    void Promise.all([ownerDeviceKey(account), fetch('/api/login', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))]).then(([key, login]) => {
      if (!modal.isConnected || store.me.account?.name !== account) return;
      code.textContent = `agent-office join ${location.origin} --token ${quote(msg.token)} --hq --owner-key ${quote(key.publicKey)}${(login as { cloudflare?: boolean }).cloudflare ? ' --cloudflare-access' : ''}`;
      fingerprint.textContent = `Owner key fingerprint: ${displayFingerprint(key.fingerprint)}. Compare it with the fingerprint printed on your Mac.`;
      copy.disabled = false;
    }).catch(e => { fingerprint.textContent = (e as Error).message; });
    copy.onclick = () => { void navigator.clipboard.writeText(code.textContent ?? '').then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Select and copy the command above'; }); };
  });
}
