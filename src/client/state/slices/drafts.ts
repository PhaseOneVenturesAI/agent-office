import type { Slice } from '../store';
import { EMPTY_BOARDS, cleanDraftName, type DraftBoards, type DraftScreen, type DraftsState, type DraftView } from '../../../shared/protocol/drafts';

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

/** What the boards say, kept to what they can show: text only, known statuses, six #rrggbb colors at most. */
function cleanBoards(x: unknown): DraftBoards {
  if (!x || typeof x !== 'object') return { ...EMPTY_BOARDS, brand: { colors: [] } };
  const b = x as Partial<DraftBoards>;
  const screens = (Array.isArray(b.screens) ? b.screens : [])
    .map((s) => ({ title: text(s?.title, 80), status: STATUSES.includes(s?.status) ? s.status : 'sketch' }) as DraftScreen)
    .filter((s) => s.title)
    .slice(0, MAX_LINES);
  const brand = b.brand && typeof b.brand === 'object' ? b.brand : { colors: [] };
  const colors = (Array.isArray(brand.colors) ? brand.colors : []).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6);
  const name = text(brand.name, 60);
  const tagline = text(brand.tagline, 120);
  return { decisions: lines(b.decisions), plan: lines(b.plan), screens, brand: { ...(name ? { name } : {}), ...(tagline ? { tagline } : {}), colors } };
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

/** The state as the page keeps it: nothing at all unless the office has drafts turned on. */
function cleanDrafts(x: DraftsState | undefined | null): DraftsState {
  if (!x || typeof x !== 'object' || !x.enabled) return NO_DRAFTS;
  const here = cleanHere(x.here);
  return { enabled: true, canStart: x.canStart === true, ...(here ? { here } : {}) };
}

export const drafts: Slice = {
  init(s) { s.drafts = NO_DRAFTS; },
  on: {
    drafts(s, m) {
      s.drafts = cleanDrafts(m.state);
      return ['drafts'];
    },
  },
  enter(s, v) { s.drafts = cleanDrafts(v.drafts); return ['drafts']; },
};
