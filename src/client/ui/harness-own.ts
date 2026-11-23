// Your own harness in the 🧰 Harness window: your CLAUDE.md, WORKFLOW.md, AGENTS.md and skills/,
// kept in your home on the office's machine and applied to your own agents only (see
// server/personal-harness.ts). Only for signed-in accounts, and only you ever see it.
import type { PersonalHarnessState } from '../../shared/protocol';
import type { Net } from '../net';
import { h, timeAgo } from './dom';
import { harnessPane, type HarnessPane } from './harness-editor';

/** Names offered when adding a file; anything under skills/ works too. */
const SUGGESTIONS = ['CLAUDE.md', 'AGENTS.md', 'WORKFLOW.md', 'skills/my-skill/SKILL.md'];

export interface OwnHarnessPane extends HarnessPane { setOwn(state: PersonalHarnessState): void }

export function ownHarnessPane(net: Net): OwnHarnessPane {
  let state: PersonalHarnessState | undefined;
  const name = h('input.harness-new-path', { type: 'text', placeholder: 'New file, e.g. AGENTS.md', 'aria-label': 'New file path', list: 'harness-own-names', maxlength: '300' }) as HTMLInputElement;
  const add = h('button.btn', { type: 'button' }, '＋ Add');
  const names = h('datalist', { id: 'harness-own-names' }, ...SUGGESTIONS.map((value) => h('option', { value })));
  const form = h('form.harness-new', { 'aria-label': 'Add a file to your harness' }, name, add, names);
  const seed = h('button.btn', { type: 'button', title: 'Copies the office’s CLAUDE.md, WORKFLOW.md, AGENTS.md and skills/ into your harness. Files you already have are kept.' }, '📋 Start from the office’s');
  const apply = h('button.btn.primary', { type: 'button', title: 'Copies your harness into your own Claude, Kimi and Codex homes; your workers load it on their next start.' }, '📣 Apply to my agents');
  const pane = harnessPane(net, {
    scope: 'harness.own',
    canEdit: () => true,
    label: 'Your harness',
    restoreHint: 'Only you can restore your harness.',
    used: 'Yours alone: CLAUDE.md (+ WORKFLOW.md) and skills/ go to your Claude; AGENTS.md (or CLAUDE.md) (+ WORKFLOW.md) and skills/ to your Kimi and Codex.',
    empty: 'No files yet. Add one above, or start from the office’s harness.',
    note: () => state ? `${state.root}\nLast applied to your agents: ${state.applied ? `${timeAgo(state.applied.at)}, ${state.applied.homes} provider homes` : 'never'}. Saving changes this file only; Apply copies it to your agents for their next start. The office’s pushes skip you.` : '',
    side: [form],
    footer: [seed, apply],
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const path = name.value.trim().replace(/^\/+/, '');
    if (!path || pane.busy()) return;
    add.disabled = true;
    try {
      await pane.api.create(path, path.endsWith('.md') ? `# ${path.split('/').at(-2) ?? path.replace(/\.md$/, '')}\n` : '');
      name.value = '';
      await pane.pick(path);
    } catch (error) {
      name.setCustomValidity((error as Error).message); name.reportValidity();
      setTimeout(() => name.setCustomValidity(''), 4000);
    } finally { add.disabled = false; }
  };
  seed.onclick = () => net.send({ t: 'harness.own.seed' });
  apply.onclick = () => net.send({ t: 'harness.own.apply' });
  return {
    ...pane,
    setOwn(next) {
      state = next;
      pane.setState({ root: next.root, files: next.files, error: next.error });
    },
  };
}
