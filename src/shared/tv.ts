// The office TV's YouTube video: what's on, shared by the server (which keeps one per floor) and the
// browser (which plays it through YouTube's embedded player, laid over the TV's screen).
import { youtubeId } from './jukebox.js';

export interface TvVideo {
  /** The YouTube video's id. */
  id: string;
  /** The link it was put on with. */
  url: string;
  /** Who put it on. */
  by: string;
  /** When it started, on the office's clock (see the 'pong' message), so everyone watches the same frame. */
  startedAt: number;
  /** How far into it it was when this was sent, in ms, for until the clocks are compared. */
  elapsed: number;
}

/** What's on the TV besides a shared screen: a YouTube video, or nothing. */
export interface TvState {
  video: TvVideo | null;
}

/** The video in a YouTube link someone pasted for the TV, or why it can't go on. */
export function checkTvUrl(raw: unknown): { id: string; url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a YouTube link to put on the TV' };
  if (s.length > 2048) return { error: 'That link is too long' };
  const id = youtubeId(s);
  if (!id) return { error: "That isn't a YouTube video link. Paste one like https://www.youtube.com/watch?v=…" };
  return { id, url: s };
}
