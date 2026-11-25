import './ui.css';
import { checkTvUrl } from '../../../shared/tv';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';

export interface TvWindowDeps {
  /** Who's sharing the screen that's on the TV, or null when nobody is. */
  sharer(): string | null;
  /** Whether you're sharing your screen. */
  sharing(): boolean;
  /** Watches the shared screen full screen. */
  watch(): void;
  /** Shares your screen, or stops sharing it. */
  toggleShare(): void;
}

/** The office TV: what's on, a box for a YouTube link, turning the video off, and sharing your screen. */
export function openTv(net: Net, deps: TvWindowDeps) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const now = h('div.tv-now');
  const url = h('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…', 'aria-label': 'YouTube link', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const play = h('button.btn.primary', { type: 'button' }, '▶️ Play on the TV');
  const share = h('button.btn', { type: 'button' }, deps.sharing() ? '⏹️ Stop sharing your screen' : '🖥️ Share your screen');
  const el = h(
    'div.modal.tv',
    { role: 'dialog', 'aria-label': 'Office TV' },
    h('header', {}, h('h2', {}, '📺 Office TV'), close),
    h(
      'div.body',
      {},
      now,
      h('label', { style: 'margin-top:16px' }, 'Put on a YouTube video'),
      h('div.webhook', {}, url, play),
      h('p.setting-note', {}, 'It plays on the TV for everyone on this floor, from the same moment, louder the closer you are. Its volume is your jukebox volume.'),
      h('label', { style: 'margin-top:16px' }, 'Or share your screen'),
      h('div', {}, share),
      h('p.setting-note', {}, 'A shared screen takes the TV over while it’s up; the video carries on underneath, quietly.'),
    ),
  );

  const render = () => {
    const v = store.tv;
    const who = deps.sharer();
    let title = 'Nothing’s on';
    let meta = 'Put on a video, or share your screen';
    let action: HTMLElement | string = '';
    if (who) {
      title = `🖥️ ${who === 'You' ? 'Your' : `${who}'s`} screen`;
      meta = v ? 'shared over a YouTube video' : 'shared on the TV';
      action = h('button.btn', { type: 'button', onclick: () => (modal.close(), deps.watch()) }, '🔍 Watch full screen');
    } else if (v) {
      title = 'YouTube video';
      meta = `put on by ${v.by}`;
    }
    const stop = v ? h('button.btn', { type: 'button', title: 'Take the video off the TV', onclick: () => net.send({ t: 'tv.stop' }) }, '⏹️ Turn off') : '';
    now.replaceChildren(h('span.tv-icon', {}, who ? '🖥️' : v ? '▶️' : '📺'), h('div.svc-main', {}, h('div.svc-title', {}, title), h('div.svc-meta', {}, meta)), action, stop);
  };

  const send = () => {
    const v = checkTvUrl(url.value);
    if ('error' in v) {
      toast(v.error, 'warn');
      return url.focus();
    }
    net.send({ t: 'tv.play', url: v.url });
    url.value = '';
  };
  play.addEventListener('click', send);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
  });
  share.addEventListener('click', () => {
    modal.close();
    deps.toggleShare();
  });

  const modal = openModal(el, { doing: '📺 at the TV', onClose: store.on('tv', render) });
  close.addEventListener('click', () => modal.close());
  render();
}
