import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkTvUrl, type TvState } from '../shared/tv.js';

interface Saved {
  id: string;
  url: string;
  by: string;
  /** When it started, on this machine's clock. */
  startedAt: number;
}

/**
 * The YouTube video on one floor's TV, saved in .agent-office/tv.json. It only says what's on and
 * since when; every browser plays it for itself, from the same point.
 */
export class TvSet {
  private s: Saved | null = null;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'tv.json');
    this.load();
  }

  state(): TvState {
    const s = this.s;
    return { video: s ? { ...s, elapsed: Math.max(0, Date.now() - s.startedAt) } : null };
  }

  /** Puts a YouTube video on, from the start. */
  play(url: unknown, by: string): { ok: true } | { error: string } {
    const v = checkTvUrl(url);
    if ('error' in v) return v;
    this.s = { id: v.id, url: v.url, by, startedAt: Date.now() };
    this.save();
    return { ok: true };
  }

  /** Turns the video off; false when nothing was on. */
  stop(): boolean {
    if (!this.s) return false;
    this.s = null;
    this.save();
    return true;
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved> | null;
      const v = s && checkTvUrl(s.url);
      if (!s || !v || 'error' in v) return;
      this.s = {
        id: v.id,
        url: v.url,
        by: typeof s.by === 'string' ? s.by.slice(0, 24) : 'Someone',
        startedAt: typeof s.startedAt === 'number' && Number.isFinite(s.startedAt) ? s.startedAt : Date.now(),
      };
    } catch {
      // a broken file just means a blank TV
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
