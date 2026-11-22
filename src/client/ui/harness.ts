import './prompts.css';
import './harness.css';
import type { HarnessFile, HarnessState, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

/** What you typed and haven't saved, by file: kept while the page is open. */
const drafts = new Map<string, string>();

/** As the server keeps it: Windows line ends and outer whitespace don't count. */
const norm = (text: string) => text.replace(/\r\n?/g, '\n').trim();

const fmtSize = (size: number) => (size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`);

/**
 * 🧰 Harness: the instruction and skill files every worker runs with — the taste lock, the
 * workflow, the skills — living in one folder on the office's machine. A list down the side, the
 * file picked on the right; admins edit, and **Push to everyone's agents** copies CLAUDE.md and
 * skills/ into the office's and every account's agent home (see server/harness.ts).
 */
export function openHarness(net: Net) {
  let state: HarnessState | undefined;
  const saved = new Map<string, string>();
  let current: string | undefined;
  let loading = false;

  const dirty = (path: string) => drafts.has(path) && norm(drafts.get(path)!) !== norm(saved.get(path) ?? '');

  const list = h('nav.prompt-list', { 'aria-label': 'Harness files' });
  const heading = h('h3');
  const status = h('span.prompt-status');
  const used = h('p.prompt-used');
  const ta = h('textarea.prompt-text', { spellcheck: 'false', 'aria-label': 'File', maxlength: '256000' }) as HTMLTextAreaElement;
  const save = h('button.btn.primary', { type: 'button' }, 'Save');
  const undo = h('button.btn', { type: 'button', title: 'Back to what’s saved' }, 'Undo changes');
  const apply = h('button.btn', { type: 'button', title: 'Copy CLAUDE.md and skills/ into the office’s and every account’s agent home' }, '📣 Push to everyone’s agents');
  const note = h('span.grow.harness-note');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.prompts.harness',
    { role: 'dialog', 'aria-label': 'Harness' },
    h('header', {}, h('h2', {}, '🧰 Harness'), close),
    h('div.prompts-body', {}, list, h('section.prompt-edit', {}, h('div.prompt-head', {}, heading, status), used, ta)),
    h('footer', {}, note, undo, save, apply),
  );

  const paintList = () => {
    list.replaceChildren();
    if (!state) return list.append(h('p.empty', {}, 'Loading…'));
    if (state.error) return list.append(h('p.empty', {}, state.error));
    if (!state.files.length) return list.append(h('p.empty', {}, 'Nothing here yet. Files added to the folder on the server show up here.'));
    let dir = '';
    for (const file of state.files) {
      const at = file.path.lastIndexOf('/');
      const d = at < 0 ? '' : file.path.slice(0, at);
      if (d !== dir) {
        dir = d;
        if (d) list.append(h('h4', {}, d));
      }
      const name = at < 0 ? file.path : file.path.slice(at + 1);
      const b = h('button.prompt-item', { type: 'button', onclick: () => pick(file.path) }, h('span', {}, name), h('span.prompt-mark')) as HTMLButtonElement;
      b.classList.toggle('on', file.path === current);
      const mark = b.querySelector('.prompt-mark')!;
      mark.textContent = dirty(file.path) ? '●' : '';
      b.title = `${file.path} · ${fmtSize(file.size)}${dirty(file.path) ? ' · not saved yet' : ''}`;
      list.append(b);
    }
  };

  const paint = () => {
    const admin = store.me.admin;
    heading.textContent = current ?? 'Pick a file';
    const isDirty = current ? dirty(current) : false;
    status.textContent = loading ? 'Loading…' : isDirty ? '● Not saved yet' : '';
    status.classList.toggle('dirty', isDirty);
    ta.readOnly = !admin || !current || loading;
    undo.classList.toggle('hidden', !admin || !isDirty);
    save.classList.toggle('hidden', !admin);
    save.toggleAttribute('disabled', !isDirty);
    apply.classList.toggle('hidden', !admin);
    const last = state?.applied;
    note.textContent = state
      ? `${state.root} · pushed ${last ? `by ${last.by} ${timeAgo(last.at)} to ${last.homes} home${last.homes === 1 ? '' : 's'}` : 'never'} — workers pick it up on their next start`
      : '';
    paintList();
  };

  const pick = (path: string) => {
    current = path;
    const draft = drafts.get(path);
    if (draft !== undefined) {
      ta.value = draft;
      paint();
      return;
    }
    const have = saved.get(path);
    if (have !== undefined) {
      ta.value = have;
      paint();
      return;
    }
    loading = true;
    ta.value = '';
    paint();
    net.send({ t: 'harness.read', path });
  };

  ta.addEventListener('input', () => {
    if (!current) return;
    if (norm(ta.value) === norm(saved.get(current) ?? '')) drafts.delete(current);
    else drafts.set(current, ta.value);
    paint();
  });
  undo.addEventListener('click', () => {
    if (!current) return;
    drafts.delete(current);
    ta.value = saved.get(current) ?? '';
    paint();
  });
  save.addEventListener('click', () => {
    if (!current || !dirty(current)) return;
    net.send({ t: 'harness.write', path: current, text: norm(ta.value) });
    saved.set(current, norm(ta.value));
    drafts.delete(current);
    paint();
  });
  apply.addEventListener('click', () => net.send({ t: 'harness.apply' }));

  const onMessage = (msg: ServerMsg) => {
    if (!el.isConnected) return;
    if (msg.t === 'harness') {
      state = msg.state;
      used.textContent = 'The taste lock, workflow and skills every worker runs with. Save edits here, then push them to everyone’s agents.';
      paint();
      if (!current && state.files.length) pick(state.files[0].path);
    } else if (msg.t === 'harness.file') {
      if (msg.text !== undefined) saved.set(msg.path, msg.text);
      if (msg.path === current) {
        loading = false;
        if (msg.text !== undefined && !drafts.has(msg.path)) ta.value = msg.text;
        if (msg.error) used.textContent = `⚠️ ${msg.error}`;
        paint();
      }
    }
  };
  net.onMessage(onMessage);
  const offMe = store.on('me', paint);
  const modal = openModal(el, {
    doing: '🧰 editing the harness',
    backdropCloses: false,
    onClose: () => offMe(),
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'harness.get' });
  paint();
  setTimeout(() => ta.focus(), 30);
}

export type { HarnessFile };
