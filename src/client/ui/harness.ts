// ☰ → 🧰 Harness: the instructions and skills workers run with. Everyone signed in with an account
// picks here whether their agents use the office's shared harness or one of their own (the same
// switch as in 🔐 Your sign-ins), and on their own, edits and applies it. The shared harness is
// shown to everyone and edited and pushed by admins.
import './prompts.css';
import './harness.css';
import type { HarnessFile, PersonalHarnessState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, type Modal } from './dom';
import { harnessPane } from './harness-editor';
import { ownHarnessPane } from './harness-own';

let currentModal: Modal | undefined;

export function openHarness(net: Net) {
  currentModal?.close();
  let alive = true, sharedRoot: { root: string; host?: string; applied?: { by: string; at: number; homes: number } } | undefined;
  let own: PersonalHarnessState | undefined, tab: 'own' | 'office' | undefined;
  const push = h('button.btn', { type: 'button', title: 'Manually copy shared defaults and skills into server agent homes; workers load them on their next start. Accounts on their own harness are skipped.' }, '📣 Push to everyone’s agents');
  const shared = harnessPane(net, {
    scope: 'harness',
    canEdit: () => store.me.admin,
    label: 'Shared Harness',
    restoreHint: 'An Office admin can restore source revisions.',
    used: 'Only CLAUDE.md and WORKFLOW.md are shared defaults, plus skill files. Project taste and review history stay separate.',
    empty: 'No supported source files yet.',
    note: () => sharedRoot ? `${sharedRoot.host ?? 'Office server'} · ${sharedRoot.root}\nLast push: ${sharedRoot.applied ? `${sharedRoot.applied.by}, ${timeAgo(sharedRoot.applied.at)}, ${sharedRoot.applied.homes} provider homes` : 'never'}. Loaded worker context: unknown. Save/restore changes this source only; push is separate, takes effect at next worker start, and skips accounts on their own harness.` : '',
    footer: [push],
  });
  const mine = ownHarnessPane(net);

  const useOffice = h('button.harness-choice', { type: 'button', role: 'radio' }, h('strong', {}, '🏢 Use the office harness'), h('span', {}, 'Admins’ pushes reach your agents.'));
  const useOwn = h('button.harness-choice', { type: 'button', role: 'radio' }, h('strong', {}, '🙋 Use my own harness'), h('span', {}, 'Keep your own instructions and skills; office pushes skip you.'));
  const mode = h('div.harness-mode', { role: 'radiogroup', 'aria-label': 'Which harness your agents use' }, useOffice, useOwn);
  const tabOwn = h('button.harness-tab', { type: 'button', role: 'tab' }, '🙋 My harness');
  const tabOffice = h('button.harness-tab', { type: 'button', role: 'tab' }, '🏢 Office harness');
  const tabs = h('div.harness-tabs', { role: 'tablist' }, tabOwn, tabOffice);
  const title = h('h2', {}, '🧰 Harness');
  const el = h('div.modal.prompts.harness', { role: 'dialog', 'aria-label': 'Harness' },
    h('header', {}, title), mode, tabs, mine.el, shared.el);

  const paint = () => {
    const account = !!store.me.account, isOwn = account && own?.mode === 'own';
    mode.hidden = !account || !own;
    useOffice.setAttribute('aria-checked', String(!isOwn)); useOwn.setAttribute('aria-checked', String(isOwn));
    useOffice.classList.toggle('on', !isOwn); useOwn.classList.toggle('on', isOwn);
    const showing = isOwn ? (tab ?? 'own') : 'office';
    tabs.hidden = !isOwn;
    tabOwn.setAttribute('aria-selected', String(showing === 'own')); tabOffice.setAttribute('aria-selected', String(showing === 'office'));
    mine.el.hidden = showing !== 'own'; shared.el.hidden = showing !== 'office';
    push.hidden = !store.me.admin;
    title.textContent = showing === 'own' ? '🧰 My harness' : '🧰 Shared Harness';
    shared.paint(); mine.paint();
  };
  useOffice.onclick = () => { if (own?.mode !== 'office') net.send({ t: 'harness.own.mode', own: false }); };
  useOwn.onclick = () => { if (own?.mode !== 'own') { tab = 'own'; net.send({ t: 'harness.own.mode', own: true }); } };
  tabOwn.onclick = () => { tab = 'own'; paint(); };
  tabOffice.onclick = () => { tab = 'office'; paint(); };
  push.onclick = () => { if (!shared.busy() && store.me.admin) net.send({ t: 'harness.apply' }); };

  const offMessage = net.onMessage((msg) => {
    if (!alive) return;
    if (msg.t === 'harness') { sharedRoot = msg.state; shared.setState(msg.state); paint(); }
    else if (msg.t === 'harness.own') { own = msg.state; mine.setOwn(msg.state); paint(); }
    // The sign-ins toggle changed it: ask again for the files and the mode.
    else if (msg.t === 'harness.opt' && store.me.account && (msg.out ? 'own' : 'office') !== own?.mode) net.send({ t: 'harness.own.get' });
  });
  const offMe = store.on('me', paint);
  const modal = openModal(el, { doing: '🧰 editing Harness sources', backdropCloses: false,
    onClose: () => { alive = false; shared.dispose(); mine.dispose(); offMessage(); offMe(); if (currentModal === modal) currentModal = undefined; } });
  currentModal = modal;
  net.send({ t: 'harness.get' });
  if (store.me.account) net.send({ t: 'harness.own.get' });
  paint();
}

export type { HarnessFile };
