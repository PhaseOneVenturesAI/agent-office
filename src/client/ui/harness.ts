import './prompts.css';
import './harness.css';
import type { HarnessFile, HarnessState } from '../../shared/protocol';
import type { HarnessSource } from '../../shared/protocol/harness-history';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, type Modal } from './dom';
import { openHarnessHistory } from './harness-history';
import { harnessRequests } from './harness-requests';

/** Exact drafts and their original hash base survive modal close/reopen. */
const drafts = new Map<string, { text: string; base: string }>();
let currentModal: Modal | undefined;
const fmtSize = (size: number) => size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;

export function openHarness(net: Net) {
  currentModal?.close();
  let state: HarnessState | undefined, file: HarnessSource | undefined, alive = true, busy = false, serial = 0;
  let history: Modal | undefined;
  const api = harnessRequests(net);
  const key = (rel: string) => `${state?.host}\0${state?.root}\0${rel}`;
  const draft = () => file ? drafts.get(key(file.path)) : undefined;
  const list = h('nav.prompt-list', { 'aria-label': 'Harness files' });
  const heading = h('h3');
  const status = h('span.prompt-status');
  const used = h('p.prompt-used', {}, 'Only CLAUDE.md and WORKFLOW.md are shared defaults, plus skill files. Project taste and review history stay separate.');
  const message = h('p.harness-editor-message', { role: 'status', 'aria-live': 'polite' });
  const comparison = h('details.harness-editor-current', {}, h('summary', {}, 'Compare current source'));
  const currentText = h('pre.harness-editor-source'); comparison.append(currentText);
  const ta = h('textarea.prompt-text', { spellcheck: 'false', 'aria-label': 'Harness source draft', maxlength: '256000' }) as HTMLTextAreaElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Save revision');
  const undo = h('button.btn', { type: 'button' }, 'Discard draft');
  const reload = h('button.btn', { type: 'button' }, 'Reload source');
  const rebase = h('button.btn', { type: 'button' }, 'Use current revision as base; keep draft');
  const revisions = h('button.btn', { type: 'button' }, 'Source history');
  const apply = h('button.btn', { type: 'button', title: 'Manually copy shared defaults and skills into server agent homes; workers load them on their next start.' }, '📣 Push to everyone’s agents');
  const note = h('p.harness-editor-scope');
  const el = h('div.modal.prompts.harness', { role: 'dialog', 'aria-label': 'Harness' },
    h('header', {}, h('h2', {}, '🧰 Shared Harness')),
    h('div.prompts-body', {}, list, h('section.prompt-edit', {}, h('div.prompt-head', {}, heading, status), used, note, message, comparison, rebase, ta,
      h('div.harness-editor-tools', {}, reload, revisions))),
    h('footer', {}, undo, save, apply));
  const say = (text: string, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const paint = () => {
    const d = draft(), stale = !!d && d.base !== file?.revision, admin = store.me.admin;
    heading.textContent = file?.path ?? 'Choose a source';
    status.textContent = busy ? 'Reading or saving…' : d ? '● Draft kept' : file?.status ?? '';
    status.classList.toggle('dirty', !!d);
    ta.readOnly = !admin || !file || file.text === null || busy;
    undo.hidden = !d; undo.disabled = busy;
    save.hidden = !admin; save.disabled = busy || !d || stale || file?.text === null;
    apply.hidden = !admin; apply.disabled = busy;
    reload.disabled = busy || !file; revisions.disabled = busy || !file;
    rebase.hidden = !stale; rebase.disabled = busy || file?.text === null;
    comparison.hidden = !file;
    if (stale) comparison.open = true;
    currentText.textContent = file ? `${file.status} · revision ${file.revision}\n\n${file.text ?? 'This source is missing or cannot be read safely. Retained history remains available.'}` : '';
    const last = state?.applied;
    note.textContent = state ? `${state.host ?? 'Office server'} · ${state.root}\nLast push: ${last ? `${last.by}, ${timeAgo(last.at)}, ${last.homes} provider homes` : 'never'}. Loaded worker context: unknown. Save/restore changes this source only; push is separate and takes effect at next worker start.` : '';
    list.replaceChildren();
    if (state?.error) list.append(h('p.empty', {}, state.error));
    else if (!state?.files.length) list.append(h('p.empty', {}, state ? 'No supported source files yet.' : 'Loading…'));
    for (const source of state?.files ?? []) {
      const b = h('button.prompt-item', { type: 'button', disabled: busy, title: `${source.path} · ${fmtSize(source.size)}`, onclick: () => void pick(source.path) },
        h('span', {}, source.path), h('span.prompt-mark', {}, drafts.has(key(source.path)) ? '●' : source.status === 'missing' || source.status === 'unavailable' ? 'history' : ''));
      b.classList.toggle('on', source.path === file?.path); list.append(b);
    }
  };
  const show = (value: HarnessSource) => { file = value; ta.value = draft()?.text ?? file.text ?? ''; };
  const pick = async (path: string) => {
    if (busy) return;
    const token = ++serial; busy = true; paint();
    try { const value = await api.read(path); if (alive && token === serial) { show(value); say(draft()?.base !== undefined && draft()!.base !== value.revision ? 'The source changed since this draft began. Compare it above before choosing a new base.' : '', !!draft() && draft()!.base !== value.revision); } }
    catch (error) { if (alive && token === serial) say((error as Error).message, true); }
    finally { if (alive && token === serial) { busy = false; paint(); } }
  };
  ta.oninput = () => {
    if (!file || busy || file.text === null) return;
    if (ta.value === file.text) drafts.delete(key(file.path));
    else drafts.set(key(file.path), { text: ta.value, base: draft()?.base ?? file.revision });
    paint();
  };
  undo.onclick = () => { if (!file || busy) return; drafts.delete(key(file.path)); ta.value = file.text ?? ''; say('Draft discarded. Current source retained.'); paint(); };
  reload.onclick = () => { if (file) void pick(file.path); };
  rebase.onclick = () => { const d = draft(); if (!file || !d || busy || file.text === null) return; d.base = file.revision; say('Draft kept with the displayed current revision as its base. Save when the comparison is resolved.'); paint(); };
  save.onclick = async () => {
    const d = draft(); if (!file || !d || busy || !store.me.admin || d.base !== file.revision) return;
    const path = file.path, token = ++serial; busy = true; paint();
    try {
      const result = await api.change({ action: 'edit', path, text: d.text, base: d.base });
      if (!alive || token !== serial) return;
      drafts.delete(key(path)); show(result.file);
      say(result.warning ?? 'Saved source revision. Prior text is retained. Nothing was pushed or sent to a worker.');
    } catch (error) {
      if (!alive || token !== serial) return;
      say((error as Error).message, true);
      try { const latest = await api.read(path); if (alive && token === serial) show(latest); } catch { /* Keep original draft/base and the save failure. */ }
    } finally { if (alive && token === serial) { busy = false; paint(); } }
  };
  revisions.onclick = () => {
    if (!file || !state || busy) return;
    const path = file.path;
    history = openHarnessHistory({ root: state.root, host: state.host ?? 'Office server', path, canEdit: () => store.me.admin,
      loadPage: (before) => api.history(path, before), loadSnapshot: (id) => api.snapshot(path, id), loadCurrent: () => api.read(path),
      blockedReason: () => drafts.has(key(path)) ? 'An unsaved draft is kept in the Harness editor. Save or discard it there before restoring a different revision.' : undefined,
      restore: async (ask) => { const result = await api.change(ask); if (alive && file?.path === path) { show(result.file); paint(); } return result; } });
  };
  apply.onclick = () => { if (!busy && store.me.admin) net.send({ t: 'harness.apply' }); };
  const offMessage = net.onMessage((msg) => {
    if (!alive || msg.t !== 'harness') return;
    state = msg.state; paint();
    if (!file && !busy && state.files.length) void pick(state.files[0].path);
  });
  const offMe = store.on('me', paint);
  const modal = openModal(el, { doing: '🧰 editing shared Harness sources', backdropCloses: false,
    onClose: () => { alive = false; ++serial; history?.close(); api.dispose(); offMessage(); offMe(); if (currentModal === modal) currentModal = undefined; } });
  currentModal = modal;
  net.send({ t: 'harness.get' }); paint();
}

export type { HarnessFile };
