import { PLAYER_H, PLAYER_W } from '../tv/player';

/** Only an https page without credentials may play live on the wall; anything else keeps the screenshot. */
export function liveSiteUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

/**
 * The pitch's home page, live, behind the wall screen's CSS3D hole (the TV technique, generalized).
 * Sandboxed: scripts run for the page to work, but no top navigation, popups, downloads or device APIs,
 * and no referrer. The screenshot stays on the wall until the page has loaded; a page that refuses
 * to be framed just leaves the screenshot showing.
 */
export class SiteFrame {
  readonly el = document.createElement('div');
  playing = false;
  private frame = document.createElement('iframe');
  constructor(url: string) {
    this.el.className = 'pitch-site-frame';
    this.el.style.cssText = `width:${PLAYER_W}px;height:${PLAYER_H}px;background:#fff;pointer-events:none;`;
    const f = this.frame;
    f.title = 'Live site';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    f.referrerPolicy = 'no-referrer';
    f.allow = '';
    f.style.cssText = 'width:100%;height:100%;border:0;';
    f.addEventListener('load', () => { this.playing = true; }, { once: true });
    f.src = url;
    this.el.append(f);
  }
  destroy() { this.playing = false; this.frame.src = 'about:blank'; this.el.remove(); }
}
