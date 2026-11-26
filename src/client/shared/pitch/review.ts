import './style.css';
import { pitchImageUrl, type PitchClientMsg, type Verdict } from '../../../shared/protocol/pitch';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import { ownerDeviceKey } from '../cubby/keys';
import { deviceTrusted } from '../cubby/devices';
import { signVerdict } from './verdict';
export const verdictLabel = (v: Verdict) => ({ approve: 'Approved', change: 'Change requested', drop: 'Dropped' })[v];
export interface ReviewDeps {
  send(m: PitchClientMsg): void;
  slide?(id: string, index: number): void;
}
/** Shared by the room and lite. No optimistic stamp: only the computer's echoed record counts. */
export function openPitchPiece(deps: ReviewDeps, pieceId: string, initial = 0, action?: Verdict) {
  if (!store.pitch) return;
  const view = store.pitch;
  const account = store.me.account?.name;
  const title = h('h2'), figure = h('div.pitch-figure'), notes = h('p'), stamp = h('p.pitch-stamp', { role: 'status' });
  const status = h('p', { role: 'status' });
  const note = h('textarea', { maxlength: 1000, rows: 2, placeholder: 'What should change?', 'aria-label': 'Change note' }) as HTMLTextAreaElement;
  const actions = h('div.pitch-actions');
  const nav = h('div.pitch-actions');
  let index = initial, busy = false, closed = false, pending = '', timer: ReturnType<typeof setTimeout> | undefined;
  let currentImage = '';
  const piece = () => store.pitch?.cubbyId === view.cubbyId && store.pitch?.pitch.version === view.pitch.version
    ? store.pitch.pitch.pieces.find(p => p.id === pieceId) : undefined;
  const paint = () => {
    const p = piece();
    if (!p) { modal.close(); return; }
    title.textContent = p.title;
    notes.textContent = p.notes.join('\n');
    stamp.textContent = p.stamp ? `${verdictLabel(p.stamp.verdict)}${p.stamp.note ? ` — ${p.stamp.note}` : ''}` : 'Awaiting your verdict';
    if (pending && store.pitch?.notice?.requestId === pending) status.textContent = store.pitch.notice.text;
    if (pending && p.stamp?.requestId === pending) { pending = ''; status.textContent = 'Saved on your computer.'; clearTimeout(timer); }
    const images = p.images.length ? p.images : p.image ? [p.image] : [];
    index = Math.min(index, Math.max(0, images.length - 1));
    const img = images[index], imageKey = img?.hash ?? 'empty';
    if (imageKey !== currentImage) {
      currentImage = imageKey;
      figure.replaceChildren(img ? h('img', { src: pitchImageUrl(view.cubbyId, img.hash), alt: p.title, referrerpolicy: 'no-referrer' }) : h('p', {}, 'No preview image published yet.'));
    }
    nav.replaceChildren();
    if (images.length > 1) {
      const go = (step: number) => { index = (index + step + images.length) % images.length; deps.slide?.(p.id, index); paint(); };
      nav.append(h('button.btn', { onclick: () => go(-1), 'aria-label': 'Previous image' }, '←'), h('span', {}, `${index + 1} / ${images.length}`), h('button.btn', { onclick: () => go(1), 'aria-label': 'Next image' }, '→'));
    }
    if (p.url) nav.append(h('a.btn', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open home page'));
    if (p.kind === 'video') nav.append(p.youtube ? h('a.btn', { href: `https://www.youtube.com/watch?v=${p.youtube}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open video') : h('span', {}, '▶ opens on your computer'));
    for (const b of actions.querySelectorAll('button')) b.disabled = busy || !!pending;
  };
  const send = async (verdict: Verdict) => {
    const p = piece(), cb = store.cubbies.cubbies.find(c => c.id === view.cubbyId && c.mine);
    if (!p || busy || pending) return;
    const text = note.value.trim();
    if (verdict === 'change' && !text) { status.textContent = 'Add a note so your lead knows what to change.'; note.focus(); return; }
    busy = true; paint();
    try {
      const key = await ownerDeviceKey(account);
      if (!deviceTrusted(cb, key)) throw Error('Add this device in your lead’s cubby chat before leaving a verdict.');
      if (cb?.lamp === 'asleep') throw Error('Reconnect your computer to save a verdict.');
      const payload = { cubbyId: view.cubbyId, floorId: view.floorId, computerId: view.computerId, version: view.pitch.version,
        pieceId, verdict, ...(text ? { note: text } : {}), requestId: crypto.randomUUID(), at: Date.now() };
      const ownerSig = await signVerdict(key, payload);
      if (closed || !piece() || store.me.account?.name !== account || store.pitch?.computerId !== view.computerId) return;
      pending = payload.requestId; status.textContent = 'Sending to your computer…';
      deps.send({ t: 'pitch.verdict', ...payload, ownerSig });
      timer = setTimeout(() => { pending = ''; status.textContent = 'Your computer has not confirmed this verdict. Check the lead chat before retrying.'; paint(); }, 20_000);
    } catch (error) { status.textContent = (error as Error).message; }
    finally { busy = false; if (!closed) paint(); }
  }
  for (const [verdict, label] of [['approve', 'Approve'], ['change', 'Change…'], ['drop', 'Drop']] as const)
    actions.append(h('button.btn', { type: 'button', onclick: () => void send(verdict) }, label));
  const el = h('div.modal.pitch-review', { role: 'dialog', 'aria-label': 'Pitch review' }, h('header', {}, title), h('div.body', {}, figure, nav, notes, stamp, note, actions, status));
  const off = store.on('pitch', paint);
  const modal = openModal(el, { onClose: () => { closed = true; off(); clearTimeout(timer); } });
  paint();
  if (action === 'change') note.focus();
  else if (action) void send(action);
  return modal;
}
