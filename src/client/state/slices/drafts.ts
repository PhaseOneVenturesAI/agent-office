import type { Slice } from '../store';
import { syncDraftImages } from '../../shared/drafts/images';
import { DRAFT_LIMITS, validDraftImageSize, EMPTY_BOARDS, cleanDraftName, type DraftBoards, type DraftFeedback, type DraftIdea, type DraftImage, type DraftScreen, type DraftsState, type DraftView, type Launched } from '../../../shared/protocol/drafts';

declare module '../store' {
  interface Store { drafts: DraftsState }
  interface Topics { drafts: true }
}

/** No drafts: an office without the feature, or anyone who may not start projects, on any floor. */
const NO_DRAFTS: DraftsState = { enabled: false, canStart: false };

/** How many lines of each board, and how long each line, the page keeps (the boards show fewer). */
const MAX_LINES = 24;
const MAX_LINE = 160;
const STATUSES: readonly DraftScreen['status'][] = ['sketch', 'review', 'approved'];

const text = (x: unknown, max = MAX_LINE): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const lines = (x: unknown): string[] => (Array.isArray(x) ? x.map((l) => text(l)).filter(Boolean).slice(0, MAX_LINES) : []);

const MIMES: readonly DraftImage['mime'][] = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIDE = 16384;

/** Several lines of text (a note, a feedback note): newlines kept, other runs of space made one, trimmed and cut. */
const para = (x: unknown, max: number): string =>
  typeof x === 'string' ? x.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const side = (x: unknown): number => (Number.isInteger(x) && (x as number) > 0 && (x as number) <= MAX_SIDE ? (x as number) : 0);

/** A card's image metadata, only when its hash, type and size are ones the page can trust to ask for. */
function cleanImage(x: unknown): DraftImage | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const i = x as Partial<DraftImage>;
  const width = side(i.width);
  const height = side(i.height);
  if (typeof i.hash !== 'string' || !/^[0-9a-f]{64}$/.test(i.hash) || !MIMES.includes(i.mime as DraftImage['mime']) || !validDraftImageSize(width, height)) return undefined;
  return { hash: i.hash, mime: i.mime as DraftImage['mime'], width, height };
}

/** A card's feedback notes, oldest first, at most DRAFT_LIMITS.feedbackPerCard (the newest). */
function cleanFeedback(x: unknown): DraftFeedback[] {
  const list = (Array.isArray(x) ? x : [])
    .map((f: Partial<DraftFeedback> | null) => ({ id: text(f?.id, 64), text: para(f?.text, DRAFT_LIMITS.feedbackText), at: typeof f?.at === 'number' && Number.isFinite(f.at) ? f.at : 0 }))
    .filter((f) => f.id && f.text);
  const seen = new Set<string>();
  return list.filter((f) => !seen.has(f.id) && seen.add(f.id)).sort((a, b) => a.at - b.at).slice(-DRAFT_LIMITS.feedbackPerCard);
}

/** What every card has: a stable id (else its title), a title, and its note, image and feedback when it has them. */
function cleanCard(x: unknown): (Omit<DraftIdea, 'id'> & { id: string }) | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const c = x as Partial<DraftIdea>;
  const title = text(c.title, 80);
  const id = text(c.id, 64) || text(c.title, 64);
  if (!title || !id) return undefined;
  const note = para(c.note, DRAFT_LIMITS.note);
  const image = cleanImage(c.image);
  return { id, title, ...(note ? { note } : {}), ...(image ? { image } : {}), feedback: cleanFeedback(c.feedback) };
}

/** Cards with an id each, the first of any two that share one. */
function cards<T extends { id: string }>(list: (T | undefined)[], max: number): T[] {
  const seen = new Set<string>();
  return list.filter((c): c is T => !!c && !seen.has(c.id) && !!seen.add(c.id)).slice(0, max);
}

/** What the boards say, kept to what they can show: text, known statuses and image types, six #rrggbb colors at most. */
function cleanBoards(x: unknown): DraftBoards {
  if (!x || typeof x !== 'object') return { ...EMPTY_BOARDS, ideas: [], screens: [], brand: { colors: [] } };
  const b = x as Partial<DraftBoards>;
  const ideas = cards((Array.isArray(b.ideas) ? b.ideas : []).map((i) => cleanCard(i)), DRAFT_LIMITS.ideas);
  const screens = cards(
    (Array.isArray(b.screens) ? b.screens : []).map((s) => {
      const c = cleanCard(s);
      return c ? ({ ...c, status: STATUSES.includes(s?.status) ? s.status : 'sketch' } as DraftScreen) : undefined;
    }),
    DRAFT_LIMITS.screens,
  );
  const brand = b.brand && typeof b.brand === 'object' ? b.brand : { colors: [] };
  const colors = (Array.isArray(brand.colors) ? brand.colors : []).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
  const name = text(brand.name, 60);
  const tagline = text(brand.tagline, 120);
  return { ideas, decisions: lines(b.decisions), plan: lines(b.plan), screens, brand: { ...(name ? { name } : {}), ...(tagline ? { tagline } : {}), colors } };
}

function cleanHere(x: unknown): DraftView | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const v = x as Partial<DraftView>;
  const name = cleanDraftName(v.name);
  if (typeof v.id !== 'string' || !v.id || !name) return undefined;
  const leadName = text(v.leadName, 24);
  return {
    id: v.id,
    name,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
    ...(typeof v.cubbyId === 'string' && v.cubbyId ? { cubbyId: v.cubbyId } : {}),
    ...(leadName ? { leadName } : {}),
    online: v.online === true,
    boards: cleanBoards(v.boards),
    designers: Math.max(0, Math.min(2, Math.floor(Number(v.designers) || 0))),
  };
}

/** What a kicked-off floor keeps (cubbies step 3): text only, the brand as the boards keep it, the approved screens' titles. */
function cleanLaunched(x: unknown): Launched | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const l = x as Partial<Launched>;
  const name = cleanDraftName(l.name);
  if (!name) return undefined;
  const repo = text(l.repo, 140);
  const screens = (Array.isArray(l.screens) ? l.screens : []).map((s) => text(s, 80)).filter(Boolean).slice(0, MAX_LINES);
  return { name, at: typeof l.at === 'number' ? l.at : 0, ...(repo ? { repo } : {}), brand: cleanBoards({ brand: l.brand }).brand, screens };
}

/** The state as the page keeps it: nothing at all unless the office has drafts turned on. */
function cleanDrafts(x: DraftsState | undefined | null): DraftsState {
  if (!x || typeof x !== 'object' || !x.enabled) return NO_DRAFTS;
  const here = cleanHere(x.here);
  const launched = cleanLaunched(x.launched);
  return { enabled: true, canStart: x.canStart === true, ...(here ? { here } : {}), ...(x.canKickoff === true ? { canKickoff: true } : {}), ...(launched ? { launched } : {}) };
}

export const drafts: Slice = {
  init(s) { s.drafts = NO_DRAFTS; },
  on: {
    drafts(s, m) {
      s.drafts = cleanDrafts(m.state);
      syncDraftImages(s.drafts.here);
      return ['drafts'];
    },
    'drafts.kicked'(s, m) {
      if (s.drafts.here?.id === m.floorId) syncDraftImages();
    },
  },
  enter(s, v) { s.drafts = cleanDrafts(v.drafts); syncDraftImages(s.drafts.here); return ['drafts']; },
};
