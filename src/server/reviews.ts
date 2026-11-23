// The Review Room: where staged deliverables wait for a human verdict, closing the quality loop.
// A worker finishing a creative task (or anyone in the office) stages its one link; it waits here
// until someone accepts or rejects it with a reason. Verdicts are evidence about that staged
// deliverable, not standing instructions for other projects. The originating worker hears the
// verdict and the reason in its terminal (the handler's part, see ws/handlers/reviews.ts).
//
// reviews.json keeps the full history. Only the visible board is capped; older evidence stays on
// disk across saves and restarts. Existing legacy feedback in the harness is left untouched.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ReviewGate, ReviewItem, ReviewKind, ReviewsState, ReviewStageName } from '../shared/protocol.js';

/** Resolved items shown on the board; older ones remain in the history file. */
const MAX_RESOLVED = 50;
const MAX_TITLE = 120;
const MAX_URL = 500;
const MAX_TEXT = 500;

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

const KINDS: ReviewKind[] = ['page', 'video', 'image', 'link'];
const STAGES: ReviewStageName[] = ['built', 'verified', 'staged', 'approved', 'released'];
const MAX_REFS = 4;
const MAX_GROUP = 40;
const MAX_VERSION = 20;
const MAX_STAGES = 30;

/** `url` as a reviewable link, or why it isn't one. */
export function reviewUrl(url: string): string | undefined {
  if (!url || url.length > MAX_URL) return 'The link is missing or too long';
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return undefined;
  } catch {
    // fall through
  }
  return 'The staged link has to be an http(s) URL';
}

export class Reviews {
  private items: ReviewItem[] = [];
  private readonly file: string;
  private loadError?: string;

  constructor(
    dataDir: string,
    private onChange: () => void,
  ) {
    this.file = path.join(dataDir, 'reviews.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved) || !saved.every(isItem)) throw new Error('Invalid review history');
      this.items = saved;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = `Couldn't load reviews; preserving the history file: ${(err as Error).message}`;
    }
  }

  state(): ReviewsState {
    let resolved = 0;
    const items = this.items.filter((i) => i.status === 'pending' || resolved++ < MAX_RESOLVED);
    return { items, pending: this.items.filter((i) => i.status === 'pending').length };
  }

  /** Stages a link for review. The item, or why it couldn't be staged. */
  submit(ask: { title: string; url: string; note?: string; gate?: ReviewGate; kind?: unknown; group?: unknown; version?: unknown; references?: unknown; by: string; workerId?: string; floorId?: string }): ReviewItem | string {
    const title = oneLine(ask.title ?? '', MAX_TITLE);
    if (!title) return 'Say what it is: title';
    const err = reviewUrl(ask.url ?? '');
    if (err) return err;
    const note = oneLine(ask.note ?? '', MAX_TEXT);
    const kind = KINDS.includes(ask.kind as ReviewKind) ? (ask.kind as ReviewKind) : undefined;
    const group = typeof ask.group === 'string' ? oneLine(ask.group, MAX_GROUP) : '';
    // Versions are allocated here, from this project's complete series history — a number the
    // client suggests is never trusted (its board is bounded), and concurrent stagings can't collide.
    let version = typeof ask.version === 'string' ? oneLine(ask.version, MAX_VERSION) : '';
    if (group) {
      let n = 0;
      for (const i of this.items) {
        if (i.group !== group || i.floorId !== ask.floorId) continue;
        const m = /^v(\d+)$/.exec(i.version ?? '');
        n = Math.max(n, m ? Number(m[1]) : 1);
      }
      version = `v${n + 1}`;
    }
    const references: string[] = [];
    if (Array.isArray(ask.references))
      for (const r of ask.references.slice(0, MAX_REFS)) {
        if (typeof r !== 'string' || reviewUrl(r)) return 'Every reference has to be an http(s) link';
        references.push(r);
      }
    const item: ReviewItem = {
      id: randomBytes(6).toString('base64url'),
      title,
      url: ask.url,
      ...(note ? { note } : {}),
      ...(ask.gate === 'passed' || ask.gate === 'failed' ? { gate: ask.gate } : {}),
      ...(kind ? { kind } : {}),
      ...(group ? { group } : {}),
      ...(version ? { version } : {}),
      ...(references.length ? { references } : {}),
      by: oneLine(ask.by, 60) || 'someone',
      ...(ask.workerId ? { workerId: ask.workerId } : {}),
      ...(ask.floorId ? { floorId: ask.floorId } : {}),
      at: Date.now(),
      status: 'pending',
      stages: [{ stage: 'staged', by: oneLine(ask.by, 60) || 'someone', at: Date.now(), note: note || 'Staged for review' }],
    };
    const items = [item, ...this.items];
    const error = this.save(items);
    if (error) return error;
    this.items = items;
    this.onChange();
    return item;
  }

  /**
   * Persists a verdict about a pending item, without changing global instructions. The item,
   * or why it didn't happen. The worker's feedback line is `prompt` when it staged the item.
   */
  resolve(id: string, ok: boolean, reason: string, by: string): { item: ReviewItem; prompt?: string } | string {
    const previous = this.items.find((i) => i.id === id);
    if (!previous) return 'That review is gone';
    if (previous.status !== 'pending') return `It was already ${previous.status}${previous.verdict ? ` by ${previous.verdict.by}` : ''}`;
    const text = oneLine(reason ?? '', MAX_TEXT);
    if (!ok && !text) return 'Say why, one line — that reason is what the next worker learns from';
    const verdict = { by, reason: text, at: Date.now() };
    const item: ReviewItem = { ...previous, status: ok ? 'accepted' : 'rejected', verdict,
      ...(ok ? { stages: [...(previous.stages ?? []), { stage: 'approved', by, at: verdict.at, note: text || 'Accepted in the Review Room' }] } : {}),
    };
    const items = this.items.map((i) => i.id === id ? item : i);
    const error = this.save(items);
    if (error) return error;
    this.items = items;
    this.onChange();
    const prompt = item.workerId
      ? `The Review Room ${ok ? 'ACCEPTED' : 'REJECTED'} your staged “${item.title}” (${item.url}) — ${by}${text ? `: ${text}` : '.'} This feedback applies to this deliverable, not other projects.${ok ? '' : ' Stage the next take when it\'s ready.'}`
      : undefined;
    return { item, ...(prompt ? { prompt } : {}) };
  }

  /**
   * Moves an item along the creative pipeline with its evidence note. Bookkeeping only: the worker
   * is not prompted on a stage move — explicit feedback comes with the verdict (see resolve).
   * A rejected take stays where it fell.
   */
  stage(id: string, stage: ReviewStageName, note: string, by: string): ReviewItem | string {
    const previous = this.items.find((i) => i.id === id);
    if (!previous) return 'That review is gone';
    if (!STAGES.includes(stage)) return 'Unknown stage';
    if (previous.status === 'rejected') return 'A rejected take is done — stage the next one instead';
    if ((stage === 'approved' || stage === 'released') && previous.status !== 'accepted')
      return 'Accept this take in the Review Room before recording approval or release';
    const text = oneLine(note ?? '', MAX_TEXT);
    if (!text) return 'Say the evidence, one line — what was checked, where it ran';
    const stages = [...(previous.stages ?? []), { stage, by, at: Date.now(), note: text }];
    if (stages.length > MAX_STAGES) return 'That take has been around the pipeline enough — stage a fresh one';
    const item: ReviewItem = { ...previous, stages };
    const items = this.items.map((i) => (i.id === id ? item : i));
    const error = this.save(items);
    if (error) return error;
    this.items = items;
    this.onChange();
    return item;
  }

  private save(items: ReviewItem[]): string | undefined {
    if (this.loadError) return this.loadError;
    const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, JSON.stringify(items, null, 1), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (err) {
      rmSync(temp, { force: true });
      return `Couldn't save the reviews: ${(err as Error).message}`;
    }
  }
}

function isItem(v: unknown): v is ReviewItem {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const i = v as Partial<ReviewItem>;
  return (
    typeof i.id === 'string' &&
    typeof i.title === 'string' &&
    typeof i.url === 'string' &&
    typeof i.by === 'string' &&
    typeof i.at === 'number' &&
    (i.status === 'pending' || i.status === 'accepted' || i.status === 'rejected')
  );
}
