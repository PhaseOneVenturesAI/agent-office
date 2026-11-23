import { store } from '../state';
import type { ClientMsg } from '../../shared/protocol';
import type { Net } from '../net';
/** Server-correlated saves shared by the Roles controls. Draft DOM stays mounted. */
export function roleSettings(net: Net, floor: string) {
  type Pending = { status: HTMLElement; button: HTMLButtonElement; label: string; saved?: () => void; draft: () => string; submitted: string };
  const pending = new Map<string, Pending>();
  const off = net.onMessage(msg => {
    if (msg.t !== 'role.settings.result' || msg.floor !== floor) return;
    const p = pending.get(msg.requestId);
    if (!p) return;
    pending.delete(msg.requestId); p.button.disabled = !net.up;
    p.status.textContent = msg.error ?? (p.draft() === p.submitted ? `${p.label} saved.` : `${p.label} submitted values saved; your newer draft is not saved.`);
    if (!msg.error) p.saved?.();
    const departments = msg.id === 'ceo' ? store.departments.departments.map(d => d.id) : [msg.id];
    for (const department of departments) net.send({t:'role.subscription.get', department});
  });
  const offStatus = net.onStatus(up => {
    for (const p of pending.values()) { p.button.disabled = !up; p.status.textContent = 'Save not confirmed. Your draft is kept; reconnect and retry.'; }
    if (up) pending.clear();
  });
  return {
    send(message: Extract<ClientMsg, {t:'ceo.set'|'departments.lead'|'departments.access'}>, status: HTMLElement, button: HTMLButtonElement, label: string, saved?: () => void) {
      if (!net.up) { status.textContent = 'Disconnected. Your draft is kept; reconnect to save.'; return; }
      if (button.disabled) return;
      const scope = button.closest('.dept-lead-form') ?? button.parentElement!;
      const draft = () => Array.from(scope.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')).map(el => el.value).join('\n');
      const requestId = crypto.randomUUID(); pending.set(requestId, {status, button, label, saved, draft, submitted: draft()});
      button.disabled = true; status.textContent = `Saving ${label.toLowerCase()}…`;
      net.send({...message, requestId});
    },
    close() { off(); offStatus(); pending.clear(); },
  };
}
export type RoleSettings = ReturnType<typeof roleSettings>;
