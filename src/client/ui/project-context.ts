import './project-context.css';
import type { ContextAction, ContextFile, ContextHistory, ContextIndex, ContextMutation, ContextRevision } from '../../shared/protocol/project-context';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';

const drafts = new Map<string, { text: string; base: string }>();
let current: Modal | undefined;

/** Actual project Markdown and its local history; not a view into a provider's private context. */
export function openProjectContext(_net: Net) {
  if (!store.floor) return;
  current?.close();
  const floor = store.floor;
  let alive = true, serial = 0, index: ContextIndex | undefined, file: ContextFile | undefined;
  let revisions: ContextRevision[] = [], next: string | undefined, busy = false;
  let selected: { id: string; text: string | null } | undefined;
  const close = h('button.btn.close', { 'aria-label': 'Close project context' }, '✕');
  const search = h('input', { type: 'search', placeholder: 'Find a source…', 'aria-label': 'Find a context source' }) as HTMLInputElement;
  const sources = h('nav.context-sources', { 'aria-label': 'Project sources' });
  const scope = h('p.context-meta');
  const message = h('p.context-message', { role: 'status' });
  const editor = h('section.context-editor');
  const el = h('div.modal.project-context', { role: 'dialog', 'aria-label': 'Project context' },
    h('header', {}, h('h2', {}, '📖 Project context'), close),
    h('div.context-scope', {}, scope,
      h('p', {}, 'Project files available to agents. Loaded context: unknown.'),
      h('details', {}, h('summary', {}, 'What these changes affect'), h('p', {}, 'Edits change actual Markdown in this floor’s checkout. Existing worker worktrees and provider contexts may differ. Changes do not sync or prompt agents.'))),
    message, h('div.context-layout', {}, h('aside', {}, search, sources), editor));
  const key = () => `${floor}\0${file?.path}`;
  const api = async <T,>(query: Record<string, string> = {}, mutation?: ContextMutation): Promise<T> => {
    const response = await fetch(`/api/project-context?${new URLSearchParams({ floor, ...query })}`, { credentials: 'same-origin',
      ...(mutation ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutation) } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Could not read project context.');
    return body as T;
  };
  const say = (text: string, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const paintSources = () => {
    const found = index?.sources.filter((s) => s.path.toLowerCase().includes(search.value.toLowerCase())) ?? [];
    sources.replaceChildren(...found.slice(0, 200).map((s) => h('button.context-source', { type: 'button', 'aria-current': file?.path === s.path ? 'true' : 'false', onclick: () => void pick(s.path) }, s.path, !s.present ? h('span', {}, s.unavailable ? 'current path unavailable · history kept' : 'archived / missing') : null)));
    if (!found.length) sources.append(h('p', {}, 'No matching project Markdown.'));
    if (found.length > 200 || index?.more) sources.append(h('p', {}, 'Search to narrow this list; the bookshelf discovery limit is 5,000 sources.'));
  };
  const historyLoad = async (more = false) => {
    if (!file) return;
    const rel = file.path, token = serial;
    const result = await api<ContextHistory>({ path: rel, history: '1', ...(more && next ? { before: next } : {}) });
    if (!alive || token !== serial) return;
    revisions = more ? [...revisions, ...result.revisions] : result.revisions; next = result.next;
  };
  const pick = async (rel: string) => {
    const token = ++serial; busy = true; selected = undefined; paint();
    try {
      const result = await api<ContextFile>({ path: rel });
      if (!alive || token !== serial) return;
      file = result; revisions = []; next = undefined; await historyLoad(); say('');
    } catch (error) { if (alive && token === serial) say(String((error as Error).message), true); }
    finally { if (alive && token === serial) { busy = false; paint(); paintSources(); } }
  };
  const change = async (action: ContextAction, reason: string, extra: Partial<ContextMutation> = {}) => {
    if (!file || busy) return;
    if (!reason.trim()) return say('Add a reason so this decision has context in history.', true);
    const rel = file.path, token = serial;
    busy = true; paint();
    try {
      const result = await api<{ file: ContextFile; warning?: string }>({}, { path: rel, base: file.revision, action, reason, ...extra });
      if (!alive || token !== serial) return;
      file = result.file; selected = undefined;
      if (action === 'edit') drafts.delete(key());
      await historyLoad(); index = await api<ContextIndex>();
      say(result.warning ?? 'Saved in this project only. Prior revisions are kept; no commit, push or agent prompt was sent.');
    } catch (error) {
      if (alive && token === serial) {
        say((error as Error).message, true);
        try { file = await api<ContextFile>({ path: rel }); await historyLoad(); } catch { /* Keep draft and the error; deleted sources cannot be silently recreated. */ }
      }
    } finally { if (alive && token === serial) { busy = false; paint(); paintSources(); } }
  };
  const paint = () => {
    editor.replaceChildren();
    if (!file) { editor.append(h('p', {}, busy ? 'Opening source…' : 'Choose an instruction, brand brief or memory file.')); return; }
    const draft = drafts.get(key()), reason = h('input', { type: 'text', maxlength: 1000, placeholder: 'Reason for this change (kept in history)', 'aria-label': 'Change reason' }) as HTMLInputElement;
    const heading = h('h3', {}, file.path);
    editor.append(heading, h('p.context-meta', { title: file.revision }, `${file.status} · revision ${file.revision.slice(0, 16)}… · provider context: unknown`));
    const currentText = h('pre.context-text', {}, file.text ?? (file.status === 'unavailable' ? 'The current source cannot be read safely (its folder may be missing, moved or linked). Saved history remains inspectable below. Restore requires a safe existing parent folder.' : 'This file is absent from the checkout. Its recorded revisions remain below.'));
    editor.append(h('details.context-current', { open: (!draft && !selected) || (!!draft && draft.base !== file.revision) }, h('summary', {}, 'Current source'), currentText));
    if (index?.canEdit && !busy) {
      if (draft) {
        const textarea = h('textarea.context-draft', { 'aria-label': 'Markdown draft', spellcheck: 'false' }) as HTMLTextAreaElement;
        textarea.value = draft.text; textarea.oninput = () => { draft.text = textarea.value; };
        editor.append(h('label', {}, 'Your draft (kept when this window closes)', textarea));
        const stale = draft.base !== file.revision;
        if (stale) editor.append(h('p.context-message.error', {}, 'The current source differs from your draft’s base. Compare Current source above before choosing a new base.'),
          h('button.btn', { type: 'button', disabled: file.text === null, onclick: () => { draft.base = file!.revision; paint(); } }, 'Use current revision as base; keep draft'));
        editor.append(reason, h('div.context-actions', {},
          h('button.btn.primary', { type: 'button', disabled: stale || file.text === null, onclick: () => void change('edit', reason.value, { text: draft.text, base: draft.base }) }, 'Save revision'),
          h('button.btn', { type: 'button', onclick: () => { drafts.delete(key()); paint(); } }, 'Discard this draft')));
      } else if (file.text !== null) editor.append(h('button.btn', { type: 'button', onclick: () => { drafts.set(key(), { text: file!.text!, base: file!.revision }); paint(); } }, 'Edit source'));
      if (!draft && !selected && file.text !== null) {
        const replacement = h('select', { 'aria-label': 'Replacement source' }, h('option', { value: '' }, 'Archive without replacement'), ...(index?.sources.filter((s) => s.present && s.path !== file!.path) ?? []).map((s) => h('option', { value: s.path }, s.path))) as HTMLSelectElement;
        editor.append(h('details.context-archive', {}, h('summary', {}, 'Archive or supersede this source…'),
          h('p', {}, 'Removes this actual file from the checkout after keeping its full prior text. References elsewhere are not rewritten. Restore it from history when needed.'), replacement, reason,
          h('button.btn', { type: 'button', onclick: () => void change(replacement.value ? 'supersede' : 'archive', reason.value, { replacement: replacement.value || undefined }) }, 'Archive source and keep history')));
      }
    }
    if (busy) editor.append(h('p', {}, 'Reading or saving…'));
    if (selected) {
      editor.append(h('h4', {}, 'Immutable prior revision'), h('pre.context-text', {}, selected.text ?? 'The file was absent before this operation.'));
      if (index?.canEdit && selected.text !== null && !busy) editor.append(reason, h('button.btn.primary', { type: 'button', onclick: () => void change('restore', reason.value, { revision: selected!.id }) }, 'Restore this text as current source'));
      editor.append(h('button.btn.small', { type: 'button', onclick: () => { selected = undefined; paint(); } }, 'Close revision'));
    }
    editor.append(h('h4', {}, `History · ${revisions.length}${next ? '+' : ''} recorded operations`), h('p.context-meta', {}, 'Every operation keeps its prior text. Applied, failed and interrupted/unconfirmed attempts stay distinct. Files changed outside Office have no recorded author here.'));
    for (const r of revisions) editor.append(h('article.context-history', {},
      h('strong', {}, `${r.action} · ${r.outcome}`), h('p', {}, `${r.by} · ${new Date(r.at).toLocaleString()} — ${r.reason}`),
      r.supersededBy ? h('p', {}, `Superseded by ${r.supersededBy}`) : null,
      r.restoredFrom ? h('p', {}, `Restored from ${r.restoredFrom}`) : null,
      h('button.btn.small', { type: 'button', disabled: busy || !r.hasText, onclick: async () => {
        const token = serial; try { const s = await api<{ text: string | null }>({ path: file!.path, revision: r.id }); if (alive && token === serial) { selected = { id: r.id, text: s.text }; paint(); } } catch (error) { say((error as Error).message, true); }
      } }, r.hasText ? 'Inspect prior text' : 'Previously absent')));
    if (next) editor.append(h('button.btn', { type: 'button', disabled: busy, onclick: async () => { try { await historyLoad(true); paint(); } catch (error) { say((error as Error).message, true); } } }, 'Load older history'));
  };
  const offFloor = store.on('floor', () => { if (store.floor !== floor) modal.close(); });
  const modal = openModal(el, { doing: '📖 inspecting project context', onClose: () => { alive = false; ++serial; offFloor(); if (current === modal) current = undefined; } });
  current = modal; close.onclick = () => modal.close(); search.oninput = paintSources;
  void api<ContextIndex>().then((result) => {
    if (!alive) return;
    index = result;
    scope.textContent = `${result.scope.project} · ${result.scope.host} · ${result.scope.source}`;
    paintSources(); paint();
  }).catch((error) => { if (alive) say((error as Error).message, true); });
}
