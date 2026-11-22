// The Review Room: where staged deliverables wait for a human verdict, closing the quality loop.
// A worker finishing a creative task (or anyone in the office) stages its one link; it waits here
// until someone accepts or rejects it with a reason. Every verdict is appended to the review
// ratchet — a managed block in the harness root's CLAUDE.md, so the next worker anyone hires, on
// any provider, starts from what the verdicts taught — and a worker that staged it hears the
// verdict and the reason in its terminal (the handler's part, see ws/handlers/reviews.ts).
//
// The board lives in reviews.json in the data dir: pending items keep forever, resolved ones are
// capped, so a verdict always stays findable without the file growing past usefulness.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ReviewGate, ReviewItem, ReviewsState } from '../shared/protocol.js';

/** Resolved items kept on the board after the newest ones; older ones fall off the file. */
const MAX_RESOLVED = 50;
/** Ratchet lines kept in the harness: enough to learn from, short enough to stay in context. */
const MAX_RATCHET = 30;
const RATCHET_START = '<!-- review-ratchet:start -->';
const RATCHET_END = '<!-- review-ratchet:end -->';
const MAX_TITLE = 120;
const MAX_URL = 500;
const MAX_TEXT = 500;

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

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

/**
 * Appends one verdict line to the review ratchet: a managed block at the end of the harness
 * root's CLAUDE.md (made when missing), so it reaches Claude homes as CLAUDE.md and Kimi and
 * Codex homes inside AGENTS.md on the next push. The block keeps the newest MAX_RATCHET lines.
 * Returns why it didn't happen.
 */
export function ratchetAppend(root: string, line: string): string | undefined {
  const file = path.join(root, 'CLAUDE.md');
  let text: string;
  try {
    text = existsSync(file) ? readFileSync(file, 'utf8') : '# Office instructions\n';
  } catch (err) {
    return `Couldn't read the harness's CLAUDE.md: ${(err as Error).message}`;
  }
  const start = text.indexOf(RATCHET_START);
  const end = text.indexOf(RATCHET_END);
  let before: string;
  let lines: string[] = [];
  if (start >= 0 && end > start) {
    before = text.slice(0, start).trimEnd();
    lines = text
      .slice(start + RATCHET_START.length, end)
      .split('\n')
      .filter((l) => l.startsWith('- '));
  } else {
    before = text.trimEnd();
  }
  lines.unshift(line);
  lines = lines.slice(0, MAX_RATCHET);
  const block = [
    RATCHET_START,
    '',
    '## Review ratchet — what the Review Room taught',
    '',
    'Verdicts on staged work, newest first. Rejections are the taste edge: never repeat them.',
    'The office manages this block — add your own instructions above it, never inside it.',
    '',
    ...lines,
    '',
    RATCHET_END,
  ].join('\n');
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${before}${before ? '\n\n' : ''}${block}\n`, { mode: 0o600 });
  } catch (err) {
    return `Couldn't write the review ratchet: ${(err as Error).message}`;
  }
  return undefined;
}

export class Reviews {
  private items: ReviewItem[] = [];
  private readonly file: string;

  constructor(
    dataDir: string,
    /** The harness root the ratchet block lives in (see ratchetAppend). */
    private ratchetRoot: string,
    private onChange: () => void,
  ) {
    this.file = path.join(dataDir, 'reviews.json');
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (Array.isArray(saved)) this.items = saved.filter(isItem);
    } catch {
      // nothing staged yet
    }
  }

  state(): ReviewsState {
    return { items: this.items, pending: this.items.filter((i) => i.status === 'pending').length };
  }

  /** Stages a link for review. The item, or why it couldn't be staged. */
  submit(ask: { title: string; url: string; note?: string; gate?: ReviewGate; by: string; workerId?: string; floorId?: string }): ReviewItem | string {
    const title = oneLine(ask.title ?? '', MAX_TITLE);
    if (!title) return 'Say what it is: title';
    const err = reviewUrl(ask.url ?? '');
    if (err) return err;
    const note = oneLine(ask.note ?? '', MAX_TEXT);
    const item: ReviewItem = {
      id: randomBytes(6).toString('base64url'),
      title,
      url: ask.url,
      ...(note ? { note } : {}),
      ...(ask.gate === 'passed' || ask.gate === 'failed' ? { gate: ask.gate } : {}),
      by: oneLine(ask.by, 60) || 'someone',
      ...(ask.workerId ? { workerId: ask.workerId } : {}),
      ...(ask.floorId ? { floorId: ask.floorId } : {}),
      at: Date.now(),
      status: 'pending',
    };
    this.items.unshift(item);
    this.save();
    this.onChange();
    return item;
  }

  /**
   * Accepts or rejects a pending item and appends the verdict to the review ratchet. The item,
   * or why it didn't happen. The worker's feedback line is `prompt` when it staged the item.
   */
  resolve(id: string, ok: boolean, reason: string, by: string): { item: ReviewItem; prompt?: string } | string {
    const item = this.items.find((i) => i.id === id);
    if (!item) return 'That review is gone';
    if (item.status !== 'pending') return `It was already ${item.status}${item.verdict ? ` by ${item.verdict.by}` : ''}`;
    const text = oneLine(reason ?? '', MAX_TEXT);
    if (!ok && !text) return 'Say why, one line — that reason is what the next worker learns from';
    const verdict = { by, reason: text, at: Date.now() };
    item.status = ok ? 'accepted' : 'rejected';
    item.verdict = verdict;
    const mark = ok ? '✅' : '❌';
    const day = new Date(verdict.at).toISOString().slice(0, 10);
    const ratchetErr = ratchetAppend(this.ratchetRoot, `- ${day} — ${mark} “${item.title}” (${item.url})${text ? ` — ${text}` : ''} (${by})`);
    if (ratchetErr) console.error(`agent-office: ${ratchetErr}`);
    this.save();
    this.onChange();
    const prompt = item.workerId
      ? `The Review Room ${ok ? 'ACCEPTED' : 'REJECTED'} your staged “${item.title}” (${item.url}) — ${by}${text ? `: ${text}` : '.'}${ok ? '' : ' Take the reason to heart and stage the next take when it\'s ready.'}`
      : undefined;
    return { item, ...(prompt ? { prompt } : {}) };
  }

  private save() {
    // Pending items keep; resolved ones beyond the cap fall off the end of the file.
    const pending = this.items.filter((i) => i.status === 'pending');
    const resolved = this.items.filter((i) => i.status !== 'pending').slice(0, MAX_RESOLVED);
    this.items = this.items.filter((i) => pending.includes(i) || resolved.includes(i));
    try {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file, JSON.stringify(this.items, null, 1), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the reviews: ${(err as Error).message}`);
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
