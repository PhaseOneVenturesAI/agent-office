import './harness-history.css';
import type { HarnessChange, HarnessHistoryPage, HarnessRevision, HarnessSnapshot, HarnessSource } from '../../shared/protocol/harness-history';
import { h, openModal, type Modal } from './dom';

export interface HarnessHistoryOptions {
  root: string;
  host: string;
  path: string;
  canEdit: () => boolean;
  loadPage: (before?: string) => Promise<HarnessHistoryPage>;
  loadSnapshot: (revision: string) => Promise<HarnessSnapshot>;
  loadCurrent: () => Promise<HarnessSource>;
  restore: (change: Extract<HarnessChange, { action: 'restore' }>) => Promise<{ file: HarnessSource; warning?: string }>;
  /** The existing editor can retain an unsaved draft and ask the user to resolve it first. */
  blockedReason?: () => string | undefined;
}

let currentModal: Modal | undefined;
const label = (entry: HarnessRevision) => entry.action === 'legacy' ? 'Legacy backup · retained' : `${entry.action === 'restore' ? 'Restore' : 'Edit'} · ${entry.outcome}`;
const short = (revision: string) => revision.length > 20 ? `${revision.slice(0, 20)}…` : revision;
const date = (at: number) => new Date(at).toLocaleString();

/** A retained-text viewer for the existing Harness editor; never a second editor or Apply path. */
export function openHarnessHistory(options: HarnessHistoryOptions): Modal {
  currentModal?.close();
  let alive = true, busy = false, serial = 0, rows: HarnessRevision[] = [], next: string | undefined;
  let selected: { entry: HarnessRevision; snapshot: HarnessSnapshot; source: HarnessSource } | undefined;
  const heading = h('h2', {}, '🕓 Harness source history');
  const message = h('p.harness-history-message', { role: 'status', 'aria-live': 'polite' });
  const list = h('nav.harness-history-list', { 'aria-label': 'Retained Harness revisions' });
  const detail = h('section.harness-history-detail', { 'aria-label': 'Revision inspection' });
  const el = h('div.modal.harness-history', { role: 'dialog', 'aria-label': 'Harness source history' },
    h('header', {}, heading),
    h('div.harness-history-scope', {}, h('strong', {}, options.path),
      h('p', {}, `Shared Harness · ${options.host}`), h('p.harness-history-meta', {}, `Source: ${options.root}/${options.path}`),
      h('details', {}, h('summary', {}, 'Scope and history limits'),
        h('p', {}, 'These are retained source revisions on this Office server. They do not show what is loaded in a running worker.'),
        h('p', {}, 'Restoring changes this source only. Apply remains a separate manual push for the next worker start. Project context and provider-home backups are separate.'),
        h('p', {}, 'Each Office change keeps the text it replaced. External edits have no recorded author here. Legacy backup capture time is known; its original author and edit time are unknown. Older overwritten backups cannot be recovered.'))),
    message, h('div.harness-history-layout', {}, list, detail));
  const say = (text: string, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const validSource = (source: HarnessSource) => {
    if (source.path !== options.path) throw new Error('The response belongs to a different Harness source.');
    return source;
  };
  const paint = () => {
    list.replaceChildren(h('h3', {}, `History · ${rows.length}${next ? '+' : ''}`));
    if (!rows.length) list.append(h('p', {}, busy ? 'Loading retained history…' : 'No retained revisions yet. The next save keeps the current text.'));
    for (const entry of rows) list.append(h('button.harness-history-row', {
      type: 'button', disabled: busy, 'aria-current': selected?.entry.id === entry.id ? 'true' : 'false', onclick: () => void inspect(entry),
    }, h('strong', {}, label(entry)),
    h('span', {}, entry.action === 'legacy' ? `Captured ${date(entry.at)}` : `${entry.by ?? 'Unknown operator'} · ${date(entry.at)}`),
    h('span', {}, entry.hasText ? 'Inspect retained text' : 'Source was absent')));
    if (next) list.append(h('button.btn', { type: 'button', disabled: busy, onclick: () => void load(true) }, 'Load older history'));
    detail.replaceChildren();
    if (!selected) { detail.append(h('p', {}, 'Choose a revision to inspect its retained text and compare it with the current source.')); return; }
    const { entry, snapshot, source } = selected;
    detail.append(h('h3', {}, entry.action === 'legacy' ? 'Legacy backup text' : `Text before this ${entry.action}`),
      h('p.harness-history-meta', {}, `${label(entry)} · ${entry.action === 'legacy' ? 'original author and edit time unknown' : `operation by ${entry.by ?? 'unknown operator'}`}`),
      h('p.harness-history-meta', {}, `Captured ${date(entry.at)}`),
      h('p.harness-history-meta', { title: entry.id }, `History entry: ${entry.id}`),
      h('p.harness-history-meta', { title: entry.before }, `Retained content revision: ${entry.before}`),
      h('pre.harness-history-text', { 'aria-label': 'Retained source text' }, snapshot.text ?? 'The source was absent before this operation.'));
    if (entry.outcome === 'failed') detail.append(h('p.harness-history-notice', {}, 'This operation failed. Its retained prior text is preserved; it does not mean the attempted change landed.'));
    if (entry.outcome === 'unconfirmed') detail.append(h('p.harness-history-notice', {}, 'Completion was not recorded. The source may have changed; inspect the current source below before deciding.'));
    if (entry.restoredFrom) detail.append(h('p.harness-history-meta', {}, `That operation restored entry ${entry.restoredFrom}.`));
    detail.append(h('details.harness-history-current', {},
      h('summary', {}, `Compare current source · ${source.status} · ${short(source.revision)}`),
      h('p.harness-history-meta', {}, `Current content revision: ${source.revision}`),
      h('pre.harness-history-text', { 'aria-label': 'Current source text' }, source.text ?? (source.status === 'unavailable' ? 'This path cannot be read safely. Restore requires its safe parent folder.' : 'The source is currently absent.'))));
    const block = options.blockedReason?.();
    const unavailable = source.status === 'unavailable';
    const same = snapshot.text !== null && snapshot.text === source.text;
    if (block) detail.append(h('p.harness-history-notice', {}, block));
    if (same) detail.append(h('p', {}, 'This retained text already matches the current source.'));
    if (options.canEdit() && snapshot.text !== null && !same && !unavailable && !block) {
      const confirm = h('input', { type: 'checkbox', disabled: busy }) as HTMLInputElement;
      const restore = h('button.btn.primary', { type: 'button', disabled: true }, 'Restore this text');
      confirm.onchange = () => { restore.disabled = busy || !confirm.checked; };
      restore.onclick = () => { if (confirm.checked) void restoreSelected(); };
      detail.append(h('label.harness-history-confirm', {}, confirm, h('span', {}, 'Replace the current source with this retained text. Its current text will also be kept in history.')),
        h('div.harness-history-actions', {}, restore));
    } else if (!options.canEdit()) detail.append(h('p', {}, 'An Office admin can restore source revisions.'));
    detail.append(h('button.btn', { type: 'button', disabled: busy, onclick: () => void inspect(entry) }, 'Reload current source'));
    if (busy) detail.append(h('p', { role: 'status' }, 'Reading or saving…'));
  };
  const inspect = async (entry: HarnessRevision) => {
    if (busy) return;
    const token = ++serial; busy = true; paint(); say('');
    try {
      const [snapshot, source] = await Promise.all([options.loadSnapshot(entry.id), options.loadCurrent()]);
      if (!alive || token !== serial) return;
      if (snapshot.id !== entry.id || snapshot.path !== options.path) throw new Error('The revision response belongs to a different source.');
      selected = { entry, snapshot, source: validSource(source) };
    } catch (error) { if (alive && token === serial) say((error as Error).message, true); }
    finally { if (alive && token === serial) { busy = false; paint(); } }
  };
  const load = async (more = false) => {
    if (busy) return;
    const token = ++serial; busy = true; paint();
    try {
      const result = await options.loadPage(more ? next : undefined);
      if (!alive || token !== serial) return;
      if (result.revisions.some((entry) => entry.path !== options.path)) throw new Error('The history response belongs to a different source.');
      const all = more ? [...rows, ...result.revisions] : result.revisions;
      rows = [...new Map(all.map((entry) => [entry.id, entry])).values()]; next = result.next;
    } catch (error) { if (alive && token === serial) say((error as Error).message, true); }
    finally { if (alive && token === serial) { busy = false; paint(); } }
  };
  const restoreSelected = async () => {
    if (busy || !selected || !options.canEdit()) return;
    const block = options.blockedReason?.(); if (block) return say(block, true);
    const { entry, source } = selected, token = ++serial;
    busy = true; paint(); say('');
    try {
      const result = await options.restore({ path: options.path, action: 'restore', revision: entry.id, base: source.revision });
      if (!alive || token !== serial) return;
      selected.source = validSource(result.file);
      say(result.warning ?? 'Restored the shared source. Prior text is retained. Nothing was Applied or sent to a worker.');
      // Mutation acknowledgment stands independently of this optional history refresh.
      try {
        const refreshed = await options.loadPage();
        if (alive && token === serial && refreshed.revisions.every((r) => r.path === options.path)) { rows = refreshed.revisions; next = refreshed.next; }
      } catch { if (alive && token === serial) say(`${message.textContent} History refresh failed; reopen to reload it.`); }
    } catch (error) { if (alive && token === serial) say(`${(error as Error).message} The retained text remains selected. Reload current source to compare before retrying.`, true); }
    finally { if (alive && token === serial) { busy = false; paint(); } }
  };
  const modal = openModal(el, { doing: '🕓 inspecting shared Harness history', backdropCloses: false,
    onClose: () => { alive = false; ++serial; if (currentModal === modal) currentModal = undefined; } });
  currentModal = modal;
  void load();
  return modal;
}
