import './departments.css';
import type { Department, DeptBriefRev, DeptPreset, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { markdown } from './markdown';
import { agentFields, officeChoice } from './provider';
import { openReviews } from './reviews';
import { openDeploys } from './deploys';
import { openProjectContext } from './project-context';
import { acknowledgeBriefDraft, type BriefDraft } from './department-draft';
import { delegateBlock, leadBlock, leadForm, leadStatusText, policyBlock } from './dept-lead';
import { ceoBlock } from './ceo';
import { openEngineSwap } from './engine-swap';

const PRESET_META: Record<DeptPreset, { icon: string; label: string; blurb: string }> = {
  marketing: { icon: '📣', label: 'Marketing', blurb: 'Story, Art & frontend, Film and Review — brief, brand library and staged takes.' },
  product: { icon: '🛠️', label: 'Product & Engineering', blurb: 'Builder and Reviewer — scoped changes that land as pull requests.' },
  review: { icon: '🔍', label: 'Review', blurb: 'Reviewer and Second look — verdicts with reasons, nothing ships unseen.' },
};

const KIND_LABEL = { implementation: 'writes', review: 'reviews', support: 'supports' } as const;

/** Live implementation writers on this floor: rostered ones plus every unrostered agent at a desk. */
const liveWriters = (state: Department[]) => {
  const rostered = new Set(state.flatMap((d) => d.roster.map((r) => r.workerId)));
  let n = 0;
  for (const d of state)
    for (const r of d.roster) {
      const role = d.roles.find((x) => x.id === r.role);
      if (role?.kind === 'implementation' && store.workers.has(r.workerId)) n++;
    }
  for (const [id, w] of store.workers) if (!rostered.has(id) && w.kind === 'agent') n++;
  return n;
};

const fmtSize = (size: number) => (size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`);

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
const VIDEO = new Set(['mp4', 'webm', 'mov']);

/** A read-only document/asset viewer modal. */
function viewer(title: string, content: HTMLElement, doing: string) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const modal = openModal(h('div.modal.dept-doc', { role: 'dialog', 'aria-label': title }, h('header', {}, h('h2', {}, title), close), h('div.dept-doc-body', {}, content)), { doing });
  close.addEventListener('click', () => modal.close());
}

/**
 * 🏬 Departments: the floor's corners of work. The window shows one approachable card per
 * department and only the selected department's panel — brief, lead, roles, work — with the
 * advanced configuration (history, brand library, context, results) behind Details. A department
 * is still paperwork and furniture: nothing here ever launches an agent by itself
 * (see docs/department-leads.md).
 */
export function openDepartments(net: Net) {
  if (!store.floor) return;
  const floor = store.floor;
  /** Brief drafts by department: text and base revision together, surviving repaints (see BriefDraft). */
  const drafts = new Map<string, BriefDraft>();
  /** Archived brief revisions that arrived, by department. */
  const archives = new Map<string, { revs: DeptBriefRev[]; archived: number; next?: number }>();
  /** The selected department's id: the panel shows this one only. */
  let selectedId: string | null = null;

  const openHistories = new Set<string>();
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const cards = h('div.dept-cards');
  const panel = h('div.dept-panel');
  const el = h(
    'div.modal.departments',
    { role: 'dialog', 'aria-label': 'Departments' },
    h('header', {}, h('h2', {}, '🏬 Departments'), close),
    h('p.dept-intro', {}, 'Talk to your CEO or a manager, see what the team is making, and help when they need you.'),
    ceoBlock(net, () => paint()),
    h('div.dept-layout', {}, cards, panel),
  );

  const assetUrl = (ref: string) => `/api/docs/asset?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(ref)}`;

  /** Opens a brand/asset reference: a project file (read-only, revalidated server-side) or a link. */
  const openAsset = (d: Department, assetId: string) => {
    const a = d.assets.find((x) => x.id === assetId);
    if (!a) return;
    if (a.kind === 'link') return void window.open(a.ref, '_blank', 'noopener,noreferrer');
    const ext = a.ref.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'md' || ext === 'markdown') {
      void fetch(`/api/docs/file?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(a.ref)}`, { credentials: 'same-origin' })
        .then(async (res) => {
          // A traveled or closed panel never opens the old project's documents.
          if (!el.isConnected || store.floor !== floor) return;
          const body = (await res.json()) as { text?: string; error?: string };
          if (!el.isConnected || store.floor !== floor) return;
          viewer(`📄 ${a.label}`, body.text !== undefined ? markdown(body.text) : h('p.empty', {}, body.error ?? 'Couldn’t read that file'), `📄 reading ${a.label}`);
        })
        .catch(() => {});
    } else if (IMAGE.has(ext)) {
      viewer(`🖼️ ${a.label}`, h('img.dept-media', { src: assetUrl(a.ref), alt: a.label }) as HTMLElement, `🖼️ looking at ${a.label}`);
    } else if (VIDEO.has(ext)) {
      viewer(`🎞️ ${a.label}`, h('video.dept-media', { src: assetUrl(a.ref), controls: 'controls', preload: 'metadata' }) as HTMLElement, `🎞️ watching ${a.label}`);
    } else if (ext === 'pdf') {
      window.open(assetUrl(a.ref), '_blank', 'noopener,noreferrer');
    } else {
      toast(`That kind of file doesn’t open here — it’s in the project at ${a.ref}`, 'warn');
    }
  };

  const briefBlock = (d: Department, repaint: () => void) => {
    const latest = d.brief[0];
    const block = h('div.dept-block');
    block.append(h('h4', {}, '📋 Brief', latest ? h('span.dept-meta', {}, ` · rev ${latest.rev} · ${latest.by} · ${timeAgo(latest.at)}`) : null));
    const draft = drafts.get(d.id);
    if (draft) {
      const ta = h('textarea.dept-brief-edit', { spellcheck: 'false', 'aria-label': 'Department brief' }) as HTMLTextAreaElement;
      ta.value = draft.text;
      ta.addEventListener('input', () => (draft.text = ta.value));
      // Another revision landed under the draft: the save will be refused as a conflict — say so
      // here, and offer to start over from what landed (the draft text stays yours to copy).
      const conflicted = d.rev !== draft.base;
      const saveBtn = h('button.btn.primary.small', { type: 'button', onclick: () => { draft.saving = draft.text.trim(); net.send({ t: 'departments.brief', id: d.id, text: draft.text, base: draft.base }); } }, 'Save revision') as HTMLButtonElement;
      saveBtn.disabled = conflicted;
      const rows: (Node | null)[] = [
        conflicted ? h('p.dept-conflict', {}, `⚠️ Rev ${d.rev} landed while you’ve been editing (your draft is based on rev ${draft.base}). Saving is refused until you start over from the latest — your text above is kept.`) : null,
        ta,
        h(
          'div.dept-row',
          {},
          saveBtn,
          h('button.btn.small', { type: 'button', onclick: () => { drafts.delete(d.id); repaint(); } }, 'Discard draft'),
          conflicted ? h('button.btn.small', { type: 'button', onclick: () => { drafts.set(d.id, { text: latest?.text ?? '', base: d.rev }); repaint(); } }, 'Start over from latest') : null,
        ),
      ];
      block.append(...rows.filter((x): x is Node => x !== null));
      return block;
    }
    block.append(
      latest ? h('p.dept-brief', {}, latest.text) : h('p.empty', {}, 'No brief yet — the first hire is asked what “good” means. Write one line and the next hires start with it.'),
      h('button.btn.small', { type: 'button', onclick: () => { drafts.set(d.id, { text: latest?.text ?? '', base: d.rev }); repaint(); } }, latest ? '✏️ New revision' : '✏️ Write the brief'),
    );
    if (d.brief.length > 1 || d.briefArchived > 0) {
      const history = h('details.dept-history', {}, h('summary', {}, 'History')) as HTMLDetailsElement;
      history.open = openHistories.has(d.id);
      const paintHistory = () => {
        const archived = archives.get(d.id);
        const rows: (Node | null)[] = [
          h('summary', {}, `${d.brief.length > 1 ? `${d.brief.length - 1} earlier revision${d.brief.length === 2 ? '' : 's'}` : 'History'}${d.briefArchived ? ` · ${d.briefArchived} archived` : ''}`),
          ...d.brief.slice(1).map((r) => h('p.dept-brief.old', {}, h('span.dept-meta', {}, `rev ${r.rev} · ${r.by} · ${timeAgo(r.at)} — `), r.text)),
          ...(archived ? archived.revs.map((r) => h('p.dept-brief.old', {}, h('span.dept-meta', {}, `rev ${r.rev} (archived) · ${r.by} · ${timeAgo(r.at)} — `), r.text)) : []),
          d.briefArchived > 0 && !archived
            ? h('button.btn.small', { type: 'button', onclick: () => net.send({ t: 'departments.brief.history', id: d.id }) }, `Load the ${d.briefArchived} archived revision${d.briefArchived === 1 ? '' : 's'}`)
            : null,
          archived?.next ? h('button.btn.small', { type: 'button', onclick: () => net.send({ t: 'departments.brief.history', id: d.id, before: archived.next }) }, 'Load older revisions') : null,
        ];
        history.replaceChildren(...rows.filter((x): x is Node => x !== null));
      };
      history.addEventListener('toggle', () => {
        if (!history.isConnected) return;
        if (history.open) openHistories.add(d.id); else openHistories.delete(d.id);
        if (history.open && d.briefArchived > 0 && !archives.has(d.id)) net.send({ t: 'departments.brief.history', id: d.id });
        paintHistory();
      });
      paintHistory();
      block.append(history);
    }
    return block;
  };

  /** Direct hires present the provider/model picker, prefilled from the saved policy (else the office default). */
  const hireFields = (d: Department) =>
    agentFields(store.project, `dept-hire-${d.id}`, d.policy ? { provider: d.policy.provider, ...(d.policy.model ? { model: d.policy.model } : {}), ...(d.policy.effort ? { effort: d.policy.effort } : {}) } : officeChoice(store.project));

  const rolesBlock = (d: Department, writers: number) => {
    const block = h('div.dept-block', {}, h('h4', {}, `🎭 Roles · writers ${writers}/2`));
    const fields = hireFields(d);
    block.append(h('p.dept-hint', {}, 'Direct hires run on:'), fields.element);
    for (const role of d.roles) {
      const task = h('input.dept-task', { type: 'text', placeholder: 'The task, one line (optional)', maxlength: '200' }) as HTMLInputElement;
      const capped = role.kind === 'implementation' && writers >= 2;
      const hire = h('button.btn.small.primary', { type: 'button', title: capped ? 'Two writers are already at work on this project — review or ship what’s in flight first' : `Seat a ${role.name} in the corner, brief and skills in its prompt` }, 'Hire') as HTMLButtonElement;
      hire.disabled = capped;
      const go = () => {
        if (!fields.valid()) return;
        net.send({ t: 'departments.launch', id: d.id, role: role.id, prompt: task.value.trim() || undefined, provider: fields.value(), model: fields.model(), effort: fields.effort() });
        task.value = '';
      };
      hire.addEventListener('click', go);
      task.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
      block.append(
        h(
          'div.dept-role',
          {},
          h('div.dept-role-head', {}, h('strong', {}, role.name), h('span.dept-chip', {}, KIND_LABEL[role.kind]), ...role.skills.map((s) => h('span.dept-chip.skill', { title: 'Read from the worker’s skills/ directory when present' }, s))),
          h('p.dept-hint', {}, role.hint),
          h('div.dept-row', {}, task, hire),
        ),
      );
    }
    return block;
  };

  const workBlock = (d: Department) => {
    const block = h('div.dept-block', {}, h('h4', {}, '🪑 Work'));
    if (!d.roster.length && !d.desks.length) return block.append(h('p.empty', {}, 'No one hired into this department yet.')), block;
    for (const r of d.roster) {
      const w = store.workers.get(r.workerId);
      const role = r.role === 'lead' ? '🎖️ Lead' : (d.roles.find((x) => x.id === r.role)?.name ?? '?');
      block.append(
        h(
          'div.dept-row',
          {},
          h('span', {}, w ? `${w.name} — ${w.status.replace('_', ' ')}` : 'a worker (gone)'),
          h('span.dept-meta', {}, `${role} · hired by ${r.by} · ${timeAgo(r.at)}`),
          w && w.kind === 'agent' ? h('button.btn.small', { type: 'button', title: 'Hand this worker’s task to a replacement engine', onclick: () => openEngineSwap(net, w.id) }, '🔁') : null,
          h('button.btn.small', { type: 'button', title: 'Off the roster; the worker itself stays', onclick: () => net.send({ t: 'departments.release', id: d.id, workerId: r.workerId }) }, 'Release'),
        ),
      );
    }
    return block;
  };

  const brandBlock = (d: Department) => {
    const block = h('div.dept-block', {}, h('h4', {}, '🎨 Brand & assets'));
    if (!d.assets.length) block.append(h('p.empty', {}, 'No references yet — add the brand guide, the winning take, the mood board.'));
    const sorted = [...d.assets].sort((a, b) => (a.status === b.status ? b.at - a.at : a.status === 'current' ? -1 : 1));
    for (const a of sorted)
      block.append(
        h(
          'div.dept-row',
          {},
          h('button.dept-asset', { type: 'button', title: a.ref, onclick: () => openAsset(d, a.id) }, `${a.kind === 'file' ? '📄' : '🔗'} ${a.label}`),
          a.status === 'historical' ? h('span.dept-chip', {}, 'historical') : null,
          h('span.dept-meta', {}, `${a.by} · ${timeAgo(a.at)}`),
          h('button.btn.small', { type: 'button', title: 'Drop this reference', onclick: () => net.send({ t: 'departments.asset.drop', id: d.id, asset: a.id }) }, '✕'),
        ),
      );
    const label = h('input.dept-asset-label', { type: 'text', placeholder: 'What it is', maxlength: '60' }) as HTMLInputElement;
    const kind = h('select', { 'aria-label': 'Kind' }, h('option', { value: 'file' }, 'File in project'), h('option', { value: 'link' }, 'Link')) as HTMLSelectElement;
    const ref = h('input.dept-asset-ref', { type: 'text', placeholder: 'docs/brand.md, assets/logo.png or https://…', maxlength: '300' }) as HTMLInputElement;
    const status = h('select', { 'aria-label': 'Status' }, h('option', { value: 'current' }, 'current'), h('option', { value: 'historical' }, 'historical')) as HTMLSelectElement;
    const add = () => {
      if (!label.value.trim() || !ref.value.trim()) return (label.value.trim() ? ref : label).focus();
      net.send({ t: 'departments.asset', id: d.id, label: label.value.trim(), kind: kind.value as 'file' | 'link', ref: ref.value.trim(), status: status.value as 'current' | 'historical' });
      label.value = '';
      ref.value = '';
    };
    block.append(h('div.dept-row.dept-asset-add', {}, label, kind, ref, status, h('button.btn.small', { type: 'button', onclick: add }, 'Add')));
    return block;
  };

  const resultsBlock = () => {
    const here = store.reviews.items.filter((i) => i.floorId === floor);
    const waiting = here.filter((i) => i.status === 'pending').length;
    return h(
      'div.dept-block',
      {},
      h('h4', {}, '🎬 Review & results'),
      h(
        'div.dept-row',
        {},
        h('span', {}, waiting ? `${waiting} take${waiting === 1 ? '' : 's'} waiting for a verdict` : 'Nothing waiting for review'),
        h('button.btn.small', { type: 'button', onclick: () => openReviews(net) }, 'Open the Review Room'),
      ),
      h(
        'div.dept-row',
        {},
        h('span', {}, store.deploys.configured ? `${store.deploys.items.length} deployment${store.deploys.items.length === 1 ? '' : 's'} on the board` : 'No deployments configured'),
        h('button.btn.small', { type: 'button', onclick: () => openDeploys(net) }, 'Open the Deploy board'),
      ),
    );
  };

  const contextBlock = () => {
    const srcs = store.departments.sources;
    const open = (path: string) =>
      void fetch(`/api/docs/file?floor=${encodeURIComponent(floor)}&path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
        .then(async (res) => {
          if (!el.isConnected || store.floor !== floor) return;
          const body = (await res.json()) as { text?: string; error?: string };
          if (!el.isConnected || store.floor !== floor) return;
          viewer(`📄 ${path}`, body.text !== undefined ? markdown(body.text) : h('p.empty', {}, body.error ?? 'Couldn’t read that file'), `📄 reading ${path}`);
        })
        .catch(() => {});
    return h(
      'div.dept-block',
      {},
      h('h4', {}, '📎 Context'),
      h('button.btn.small', { type: 'button', onclick: () => openProjectContext(net) }, 'Inspect & edit project context'),
      h('p.dept-meta', {}, 'This project’s own instruction files — available to the workers hired here (whether a running agent has loaded them is between it and its terminal). The office-wide shared defaults and skills live under ☰ → 🧰 Harness.'),
      ...srcs.map((s) =>
        h(
          'div.dept-row',
          {},
          s.exists && s.size !== undefined
            ? h('button.dept-asset', { type: 'button', title: `${s.path} · ${fmtSize(s.size)} — read it`, onclick: () => open(s.path) }, `✓ ${s.path}`)
            : h('span', {}, `${s.exists ? '✓' : '—'} ${s.path}`),
          s.exists ? h('span.dept-meta', {}, s.size !== undefined ? fmtSize(s.size) : 'folder') : h('span.dept-meta', {}, 'missing'),
        ),
      ),
    );
  };

  /** Only the selected department's panel: the lead hero up front, configuration under Manage. */
  const paintPanel = (d: Department, writers: number) => {
    panel.replaceChildren();
    const meta = PRESET_META[d.preset];
    const repaint = () => paint();
    let replacing = false;
    const manage = h(
      'details.dept-advanced',
      {},
      h('summary', {}, 'Manage — lead, engine, brand & results'),
      h(
        'div.dept-block',
        {},
        h('h4', {}, '🎛️ This department'),
        h('p.dept-meta', {}, `Opened by ${d.by} · ${timeAgo(d.at)}${d.lead ? ` · manager named by ${d.lead.by}` : ''}`),
        ...(d.lead
          ? [
              replacing
                ? leadForm(net, d, d.lead, () => { replacing = false; paintPanel(d, liveWriters(store.departments.departments)); })
                : h('div.dept-row', {}, h('button.btn.small', { type: 'button', onclick: () => { replacing = true; paintPanel(d, liveWriters(store.departments.departments)); } }, 'Replace the manager…')),
              h('div.dept-row', {}, h('button.btn.small', { type: 'button', title: 'Retire the manager identity; their worker, when on shift, keeps its desk', onclick: () => net.send({ t: 'departments.lead.clear', id: d.id }) }, 'Retire the manager')),
            ]
          : []),
        h('div.dept-row', {}, h('button.btn.small', { type: 'button', title: 'Take the department off this floor (refused while its workers are at desks)', onclick: () => net.send({ t: 'departments.remove', id: d.id }) }, 'Remove the department')),
      ),
      policyBlock(net, d, repaint),
      brandBlock(d),
      resultsBlock(),
      contextBlock(),
    );
    panel.append(
      h(
        'section.dept',
        {},
        h(
          'header.dept-head',
          {},
          h('h3', {}, `${meta.icon} ${d.name}`),

        ),
        leadBlock(net, d, repaint),
        briefBlock(d, repaint),
        h('details.dept-block', {}, h('summary', {}, 'Add a teammate yourself'), rolesBlock(d, writers)),
        workBlock(d),
        delegateBlock(net, d),
        manage,
      ),
    );
  };

  const paint = () => {
    const state = store.departments;
    // A landed revision that echoes a saving draft retires it; everything else stays a draft.
    for (const [id, draft] of drafts) {
      if (!draft.saving) continue;
      const d = state.departments.find((x) => x.id === id);
      const landed = d?.brief[0];
      const next = acknowledgeBriefDraft(draft, landed);
      if (next) drafts.set(id, next); else drafts.delete(id);
    }
    const writers = liveWriters(state.departments);
    cards.replaceChildren();
    panel.replaceChildren();
    if (state.error) {
      cards.append(h('p.dept-conflict', { role: 'alert' }, state.error));
      return;
    }
    const taken = new Set(state.departments.map((d) => d.preset));
    const addRow = h(
      'div.dept-add',
      {},
      ...(Object.keys(PRESET_META) as DeptPreset[])
        .filter((p) => !taken.has(p))
        .map((p) => h('button.btn.small', { type: 'button', title: PRESET_META[p].blurb, onclick: () => net.send({ t: 'departments.add', preset: p }) }, `＋ ${PRESET_META[p].icon} ${PRESET_META[p].label}`)),
    );
    if (!state.departments.length) cards.append(h('p.empty', {}, 'No departments on this floor yet. Open one:'));
    if (addRow.children.length) cards.append(addRow);
    if (selectedId && !state.departments.some((d) => d.id === selectedId)) selectedId = null;
    for (const d of state.departments) {
      const meta = PRESET_META[d.preset];
      const selected = (selectedId ?? state.departments[0]?.id) === d.id;
      cards.append(
        h(
          'button.dept-card',
          { type: 'button', class: selected ? 'selected' : '', title: meta.blurb, onclick: () => { selectedId = d.id; paint(); } },
          h('span.dept-card-icon', {}, meta.icon),
          h('span.dept-card-main', {}, h('strong', {}, d.name), h('small', {}, leadStatusText(d))),
        ),
      );
    }
    const shown = state.departments.find((d) => d.id === (selectedId ?? state.departments[0]?.id));
    if (shown) paintPanel(shown, writers);
  };

  const onMessage = (msg: ServerMsg) => {
    if (!el.isConnected) return;
    if (msg.t === 'departments.brief.history') {
      const prior = archives.get(msg.id);
      const revs = [...new Map([...(prior?.revs ?? []), ...msg.revs].map((rev) => [rev.rev, rev])).values()].sort((a, b) => b.rev - a.rev);
      archives.set(msg.id, { revs, archived: msg.archived, next: msg.next });
      paint();
    }
  };
  const offs = [net.onMessage(onMessage), store.on('departments', paint), store.on('ceo', paint), store.on('workers', paint), store.on('reviews', paint), store.on('deploys', paint)];
  const modal = openModal(el, {
    doing: '🏬 organizing departments',
    onClose: () => offs.forEach((off) => off()),
  });
  close.addEventListener('click', () => modal.close());
  // Traveling closes the panel: its state and its asset links are this floor's, never the next's.
  offs.push(store.on('floor', () => modal.close()));
  paint();
}
