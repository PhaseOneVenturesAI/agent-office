// The YouTube player on the office TV: YouTube's own embedded player, 1280×720, which screen.ts lays
// over the TV's screen in 3D. It keeps to the office's clock, so everyone on the floor sees the same frame.
import { YT_BUFFERING, YT_ENDED, YT_PLAYING, loadYouTubeApi, youTubeFrame, type YTPlayer } from '../../core/youtube';

export const PLAYER_W = 1280;
export const PLAYER_H = 720;

/** Why a video won't play on the TV, from the player's error code. */
function why(code: number): string {
  if (code === 101 || code === 150 || code === 152) return "That video's owner doesn't allow it to play outside YouTube";
  if (code === 100) return 'That video is private or gone';
  if (code === 153) return "YouTube wouldn't load its player here";
  return "The TV can't play that video";
}

export class TvPlayer {
  /** The player's page element, for the 3D overlay. */
  readonly el: HTMLDivElement;
  /** Playing, with a picture to show. */
  playing = false;
  /** It ran to its end. */
  ended = false;
  /** Why it won't play, once YouTube says. */
  error: string | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private gone = false;
  private vol = -1;
  private lastSync = 0;
  /** It's played at least once: buffering after that still has a picture. */
  private started = false;

  /** `at()` is how far into the video everyone is, in seconds; `changed` hears it start, end or fail. */
  constructor(
    readonly id: string,
    private readonly at: () => number,
    private readonly changed: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tv-player';
    this.el.style.cssText = `width:${PLAYER_W}px;height:${PLAYER_H}px;background:#000;pointer-events:none;`;
    const frame = youTubeFrame(id, PLAYER_W, PLAYER_H, { disablekb: '1', iv_load_policy: '3', fs: '0' });
    frame.style.cssText = 'border:0;display:block;';
    this.el.append(frame);

    loadYouTubeApi().then(
      (YT) => {
        if (this.gone) return;
        this.player = new YT.Player(frame, {
          events: {
            onReady: () => {
              this.ready = true;
              this.setVolume(Math.max(0, this.vol));
              this.sync(true);
            },
            onStateChange: (e) => {
              if (e.data === YT_PLAYING) this.started = true;
              const playing = e.data === YT_PLAYING || (e.data === YT_BUFFERING && this.started);
              const ended = e.data === YT_ENDED;
              if (playing === this.playing && ended === this.ended) return;
              this.playing = playing;
              this.ended = ended;
              this.changed();
            },
            onError: (e) => this.fail(why(e.data)),
          },
        });
      },
      () => this.fail("YouTube's player wouldn't load. Is youtube.com blocked here?"),
    );
  }

  private fail(text: string) {
    if (this.gone) return;
    this.error = text;
    this.changed();
  }

  /** Every few seconds (or `now`), back to where everyone is if it's drifted; past its end, it stays ended. */
  sync(now = false) {
    const p = this.player;
    if (!p || !this.ready || this.error) return;
    const t = performance.now();
    if (!now && t - this.lastSync < 3000) return;
    this.lastSync = t;
    const want = this.at();
    const length = p.getDuration();
    if (length > 0 && want >= length - 0.5) {
      if (!this.ended) {
        p.pauseVideo();
        this.ended = true;
        this.playing = false;
        this.changed();
      }
      return;
    }
    // Ended by YouTube a hair before the office's clock got there: it stays ended.
    if (this.ended) return;
    // A live stream has no length, and is always at its live edge.
    if (length > 0 && Math.abs(p.getCurrentTime() - want) > 1.5) p.seekTo(want, true);
    if (now || !this.playing) p.playVideo();
  }

  /** 0–1. */
  setVolume(v: number) {
    const next = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (next === this.vol) return;
    this.vol = next;
    if (this.ready) this.player?.setVolume(next);
  }

  destroy() {
    this.gone = true;
    try {
      this.player?.destroy();
    } catch {
      // Already gone.
    }
    this.player = null;
    this.el.remove();
  }
}
