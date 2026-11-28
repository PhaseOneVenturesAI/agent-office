import type { Net } from '../../net';
import { h, openModal } from '../../ui/dom';
export interface KickoffPanel { readonly open: boolean; failed(error: string): void; close(): void }
/** Old clients and cached floor metadata cannot reopen the removed VPS kickoff flow. */
export function openKickoff(_net: Net, _floorId: string, _name: string, _lead: string): KickoffPanel {
  let open = true;
  const modal = openModal(h('div.modal', { role: 'dialog' }, h('header', {}, h('h2', {}, 'Studio')),
    h('div.body', {}, 'This draft predates the Mac Studio; start a New project')), { onClose: () => { open = false; } });
  return { get open() { return open; }, failed() {}, close: () => modal.close() };
}
