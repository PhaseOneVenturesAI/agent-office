// A YouTube video on the jukebox. A YouTube link is a web page, not audio an <audio> element can
// play, so it goes through YouTube's own embedded player, kept out of sight, which the jukebox drives
// like it drives an <audio> element: play, volume, seek, and whether it's paused.

/** The bits of YouTube's IFrame Player API the jukebox uses. */
interface YTPlayer {
  playVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getDuration(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLIFrameElement, opts: { events: Record<string, (e: { data: number; target: YTPlayer }) => void> }) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const ENDED = 0;

let api: Promise<YTNamespace> | null = null;

/** YouTube's player API, loaded once. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  api ??= new Promise<YTNamespace>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      api = null;
      reject(new Error('YouTube player failed to load'));
    };
    document.head.append(s);
  });
  return api;
}

/** Why a video won't play, from the player's error code. */
function why(code: number): string {
  if (code === 101 || code === 150 || code === 152) return "📻 That YouTube video's owner doesn't allow it to play outside YouTube";
  if (code === 100) return '📻 That YouTube video is private or gone';
  if (code === 153) return "📻 YouTube wouldn't load its player here";
  return "📻 The jukebox can't play that YouTube video";
}

/** A YouTube video playing out of sight, looping, for the jukebox. */
export class YouTubeStream {
  paused = true;
  private player: YTPlayer | null = null;
  private ready = false;
  private wanted = false;
  private vol = 1;
  private seekTo: number | null = null;
  private gone = false;
  private readonly box: HTMLDivElement;

  /** `onReady` lets the jukebox line the video up with everyone else's; `onError` says why it won't play. */
  constructor(
    id: string,
    private readonly onReady: (s: YouTubeStream) => void,
    private readonly onError: (text: string) => void,
  ) {
    // Out of sight but full size: YouTube won't play in a player that's hidden or too small.
    this.box = document.createElement('div');
    this.box.setAttribute('aria-hidden', 'true');
    this.box.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;opacity:0;pointer-events:none;';
    const frame = document.createElement('iframe');
    frame.width = '320';
    frame.height = '180';
    frame.allow = 'autoplay; encrypted-media';
    // The office's pages send no referrer, and YouTube's player refuses to play without one (error 153).
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.tabIndex = -1;
    const q = new URLSearchParams({ enablejsapi: '1', origin: location.origin, playsinline: '1', controls: '0', rel: '0' });
    frame.src = `https://www.youtube.com/embed/${id}?${q}`;
    this.box.append(frame);
    document.body.append(this.box);

    loadApi().then(
      (YT) => {
        if (this.gone) return;
        this.player = new YT.Player(frame, {
          events: {
            onReady: () => {
              this.ready = true;
              this.player?.setVolume(Math.round(this.vol * 100));
              this.onReady(this);
              if (this.seekTo != null) this.player?.seekTo(this.seekTo, true);
              this.seekTo = null;
              if (this.wanted) this.player?.playVideo();
            },
            onStateChange: (e) => {
              this.paused = e.data !== PLAYING;
              // Loop, like an audio file on the jukebox.
              if (e.data === ENDED) {
                this.player?.seekTo(0, true);
                this.player?.playVideo();
              }
            },
            onError: (e) => {
              if (!this.gone) this.onError(why(e.data));
            },
          },
        });
      },
      () => {
        if (!this.gone) this.onError("📻 YouTube's player wouldn't load. Is youtube.com blocked here?");
      },
    );
  }

  /** The video's length in seconds, or 0 until it's known (and for a live stream). */
  get duration(): number {
    return this.ready ? (this.player?.getDuration() ?? 0) : 0;
  }

  set currentTime(seconds: number) {
    if (this.ready) this.player?.seekTo(seconds, true);
    else this.seekTo = seconds;
  }

  set volume(v: number) {
    const next = Math.max(0, Math.min(1, v));
    if (Math.abs(next - this.vol) < 0.005) return;
    this.vol = next;
    if (this.ready) this.player?.setVolume(Math.round(next * 100));
  }

  get volume(): number {
    return this.vol;
  }

  play(): Promise<void> {
    this.wanted = true;
    if (this.ready) this.player?.playVideo();
    return Promise.resolve();
  }

  pause() {
    this.wanted = false;
    if (this.ready) this.player?.stopVideo();
  }

  /** Stops it and takes its player off the page. */
  destroy() {
    this.gone = true;
    this.wanted = false;
    try {
      this.player?.destroy();
    } catch {
      // Already gone.
    }
    this.player = null;
    this.box.remove();
  }
}
