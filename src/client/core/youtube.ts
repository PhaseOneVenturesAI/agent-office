// YouTube's IFrame Player API, loaded once for whatever plays YouTube in the office (the jukebox, the TV).

/** The bits of a YouTube player the office uses. */
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getDuration(): number;
  getCurrentTime(): number;
  destroy(): void;
}
export interface YTNamespace {
  Player: new (el: HTMLIFrameElement, opts: { events: Record<string, (e: { data: number; target: YTPlayer }) => void> }) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** The player's states, from onStateChange. */
export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_BUFFERING = 3;

let api: Promise<YTNamespace> | null = null;

/** YouTube's player API, loaded once. */
export function loadYouTubeApi(): Promise<YTNamespace> {
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

/** An iframe for YouTube's embedded player of video `id`, `w`×`h`, with `params` on top of the ones every player needs. */
export function youTubeFrame(id: string, w: number, h: number, params: Record<string, string> = {}): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.width = String(w);
  frame.height = String(h);
  frame.allow = 'autoplay; encrypted-media';
  // The office's pages send no referrer, and YouTube's player refuses to play without one (error 153).
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.tabIndex = -1;
  const q = new URLSearchParams({ enablejsapi: '1', origin: location.origin, playsinline: '1', controls: '0', rel: '0', ...params });
  frame.src = `https://www.youtube.com/embed/${id}?${q}`;
  return frame;
}
