import { LIMITS_PROVIDERS, type LimitsProvider, type PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** The provider the meter last showed, kept in this browser. */
const PROVIDER_KEY = 'agent-office.limits-provider';

const NAMES: Record<LimitsProvider, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi' };

function remembered(): LimitsProvider | undefined {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    return (LIMITS_PROVIDERS as readonly string[]).includes(v ?? '') ? (v as LimitsProvider) : undefined;
  } catch {
    return undefined;
  }
}

function remember(p: LimitsProvider) {
  try {
    localStorage.setItem(PROVIDER_KEY, p);
  } catch {
    // storage blocked
  }
}

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? new Date(w.resetsAt).toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const scope = w.label === 'Week' ? ' (all models)' : '';
  const title = `${w.label}${scope}: ${pct}% used${when ? `\nStarts over ${when}` : ''}`;
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, w.label),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, `resets ${fmtReset(w.resetsAt, now)}`) : null,
    ),
    h('div.meter', { class: level(w.pct), title, role: 'progressbar', 'aria-label': w.label, 'aria-valuenow': pct }, h('div.fill', { style: `width:${w.pct}%` })),
  ];
}

/** The provider toggle, when more than one provider can report limits. Switching reads them again (the panel's own click). */
function tabs(shown: LimitsProvider, avail: LimitsProvider[]): HTMLElement | null {
  if (avail.length < 2) return null;
  return h(
    'div.tabs',
    { role: 'tablist' },
    ...avail.map((p) =>
      h(
        'button',
        {
          class: p === shown ? 'on' : '',
          role: 'tab',
          'aria-selected': p === shown ? 'true' : 'false',
          onclick: () => {
            remember(p);
            renderLimits();
          },
        },
        NAMES[p],
      ),
    ),
  );
}

/** The providers' plan limits (Claude's, Codex's, Kimi's 5-hour session, week and month), under the workers. Click to read them again. */
export function renderLimits() {
  const all = store.limits;
  const el = $('limits');
  // Only providers with numbers get a tab; the meter shows the remembered one, else the first.
  const avail = LIMITS_PROVIDERS.filter((p) => (all[p]?.windows.length ?? 0) > 0);
  const pick = remembered();
  const shown = pick && avail.includes(pick) ? pick : avail[0];
  el.classList.toggle('hidden', !shown);
  if (!shown) return;
  const s = all[shown]!;
  const now = Date.now();
  const plan = s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : '';
  const toggle = tabs(shown, avail);
  el.replaceChildren(h('h3', {}, `${NAMES[shown]} limits`, plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...(toggle ? [toggle] : []), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, `As of ${new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
}
