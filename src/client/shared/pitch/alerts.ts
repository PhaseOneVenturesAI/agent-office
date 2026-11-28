import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import type { PitchServerMsg } from '../../../shared/protocol/pitch';
/** A durable server event; one card can be dismissed without replaying on snapshot refresh. */
export function pitchAlerts(net: Net, go?: (floor: string, projectIndex: number) => void) {
  let modal: Modal | undefined;
  const clear = () => { modal?.close(); modal = undefined; };
  store.on('me', clear);
  return (m: PitchServerMsg) => {
    if (m.t !== 'pitch.ready') return;
    clear();
    const card = h('div.modal.pitch-ready', { role: 'dialog', 'aria-label': 'Pitch ready' }, `Pitch ready: ${m.project} ${m.department}`,
      h('button.btn', { onclick: () => {
        clear();
        if (go) go(m.floorId, m.projectIndex);
        else {
          const select = () => net.send({ t: 'hq.pitch', projectIndex: m.projectIndex });
          if (store.floor === m.floorId) select(); else {
            const off = store.on('floor', () => { if (store.floor === m.floorId) { off(); select(); } });
            setTimeout(off, 15000); net.send({ t: 'floor.go', floor: m.floorId });
          }
        }
      } }, 'Go there'));
    modal = openModal(card);
  };
}
