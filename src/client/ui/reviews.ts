import './reviews.css';
import type { ReviewGate, ReviewItem, ReviewKind, ReviewStageName, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

const gateBadge = (gate: ReviewGate | undefined) =>
  gate === 'passed' ? h('span.review-gate.passed', {}, 'gate passed') : gate === 'failed' ? h('span.review-gate.failed', {}, 'gate failed') : null;

/** The kind a link most likely is, when the stager didn't say. */
export function kindOf(url: string): ReviewKind {
  const u = url.toLowerCase().split('?')[0];
  if (/youtu\.?be|vimeo|\.(mp4|mov|webm)$/.test(u)) return 'video';
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(u)) return 'image';
  return 'page';
}

const KIND_ICON: Record<ReviewKind, string> = { page: '📄', video: '🎞️', image: '🖼️', link: '🔗' };

const STAGE_ORDER: ReviewStageName[] = ['built', 'verified', 'staged', 'approved', 'released'];
/** "Approved" is a verdict on the take; only "released" means it's out. */
const STAGE_LABEL: Record<ReviewStageName, string> = { built: 'built', verified: 'verified', staged: 'staged', approved: 'approved', released: 'released' };

const latestStage = (item: ReviewItem) => item.stages?.[item.stages.length - 1];

/** The pipeline so far, and — for a take that can still move — the control to move it with its evidence note. */
function stageRow(net: Net, item: ReviewItem) {
  const stages = item.stages ?? [];
  const current = latestStage(item);
  const chip = current ? h('span.review-stage-chip', { title: `${current.by} · ${timeAgo(current.at)} — ${current.note}` }, STAGE_LABEL[current.stage]) : null;
  const history = stages.length
    ? h('details.review-history', {}, h('summary', {}, `pipeline (${stages.length})`), ...stages.map((s) => h('p.review-history-line', {}, h('span.review-stage-chip', {}, STAGE_LABEL[s.stage]), ` ${s.by} · ${timeAgo(s.at)} — ${s.note}`)))
    : null;
  if (item.status === 'rejected') return h('div.review-stages', {}, chip, h('span.review-meta', {}, 'rejected — stage a fresh take'), history);
  const select = h('select.review-stage-pick', { 'aria-label': 'Move to stage' }, h('option', { value: '' }, 'Move to…'), ...STAGE_ORDER.filter((s) => s !== current?.stage).map((s) => h('option', { value: s }, STAGE_LABEL[s]))) as HTMLSelectElement;
  select.addEventListener('change', () => {
    const stage = select.value as ReviewStageName;
    select.value = '';
    if (!stage) return;
    const note = window.prompt(`Evidence for “${STAGE_LABEL[stage]}” — what was checked, where it ran?`, '');
    if (!note?.trim()) return;
    net.send({ t: 'reviews.stage', id: item.id, stage, note: note.trim() });
  });
  return h('div.review-stages', {}, chip, select, history);
}

/** The references the take was judged against. */
const refRow = (item: ReviewItem) =>
  item.references?.length
    ? h('p.review-refs', {}, 'against: ', ...item.references.flatMap((r, i) => [i ? ' · ' : '', h('a', { href: r, target: '_blank', rel: 'noopener noreferrer' }, `ref ${i + 1} ↗`)]))
    : null;

/** One staged deliverable waiting for your verdict, with its ✅ / ❌ and the reason line. */
function pendingCard(net: Net, item: ReviewItem, repaint: () => void) {
  const reason = h('input.review-reason', { type: 'text', placeholder: 'One line — what the next take must learn (required to reject)', maxlength: '500' }) as HTMLInputElement;
  const decide = (ok: boolean) => {
    const text = reason.value.trim();
    if (!ok && !text) {
      reason.focus();
      reason.classList.add('wanted');
      return;
    }
    net.send({ t: 'reviews.resolve', id: item.id, ok, reason: text });
  };
  reason.addEventListener('input', () => reason.classList.remove('wanted'));
  reason.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') decide(true);
  });
  return h(
    'article.review-card.pending',
    {},
    h(
      'header',
      {},
      item.version ? h('span.review-version', {}, item.version) : null,
      h('a.review-title', { href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url }, `${KIND_ICON[item.kind ?? kindOf(item.url)]} “${item.title}” ↗`),
      gateBadge(item.gate),
    ),
    h('p.review-meta', {}, `staged by ${item.by} · ${timeAgo(item.at)}`),
    item.note ? h('p.review-note', {}, item.note) : null,
    refRow(item),
    stageRow(net, item),
    h(
      'div.review-decide',
      {},
      reason,
      h('button.btn.primary', { type: 'button', onclick: () => decide(true) }, '✅ Accept'),
      h('button.btn.danger', { type: 'button', onclick: () => decide(false) }, '❌ Reject'),
    ),
  );
}

/** A decided one: the mark, the link, who and why — and what it was judged against and where its pipeline stands, so it stays useful for comparison. */
function resolvedCard(net: Net, item: ReviewItem) {
  const mark = item.status === 'accepted' ? '✅' : '❌';
  return h(
    'article.review-card.resolved',
    {},
    h(
      'header',
      {},
      h('span.review-mark', {}, mark),
      item.version ? h('span.review-version', {}, item.version) : null,
      h('a.review-title', { href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url }, `“${item.title}” ↗`),
      h('span.review-meta', {}, `${item.status} by ${item.verdict?.by ?? '?'} · ${timeAgo(item.verdict?.at ?? item.at)}`),
    ),
    item.verdict?.reason ? h('p.review-note', {}, `“${item.verdict.reason}”`) : null,
    refRow(item),
    stageRow(net, item),
  );
}

/**
 * 🎬 Review Room: the quality loop, in one place. Workers finishing creative tasks stage their one
 * link here; you accept or reject with a one-line reason. Takes of one creative stack as versions,
 * and each move along the pipeline (built → verified → staged → approved → released) carries its
 * evidence note. Verdicts stay in review history; they do not change other projects’ instructions.
 */
export function openReviews(net: Net) {
  const list = h('div.review-list');
  const done = h('div.review-list');
  const doneWrap = h('details.review-done', {}, h('summary', {}, 'Decided'), done);

  // Staging a link by hand, for when the thing to look at didn't come from a worker.
  const stageTitle = h('input.review-stage-title', { type: 'text', placeholder: 'What it is, short', maxlength: '120' }) as HTMLInputElement;
  const stageUrl = h('input.review-stage-url', { type: 'url', placeholder: 'https://…', maxlength: '500' }) as HTMLInputElement;
  const stageGroups = h('datalist', { id: 'review-groups' });
  const stageGroup = h('input.review-stage-group', { type: 'text', placeholder: 'Series (e.g. homepage hero) — versions stack', list: 'review-groups', maxlength: '40' }) as HTMLInputElement;
  const stageRefs = h('input.review-stage-refs', { type: 'text', placeholder: 'References: up to 4 links, comma-separated (optional)', maxlength: '2100' }) as HTMLInputElement;
  const stage = () => {
    const title = stageTitle.value.trim();
    const url = stageUrl.value.trim();
    if (!title || !url) {
      (title ? stageUrl : stageTitle).focus();
      return;
    }
    const group = stageGroup.value.trim();
    const references = stageRefs.value.split(',').map((r) => r.trim()).filter(Boolean).slice(0, 4);
    // The server allocates the version from this project's complete series history.
    net.send({ t: 'reviews.submit', title, url, kind: kindOf(url), ...(group ? { group } : {}), ...(references.length ? { references } : {}) });
    stageTitle.value = '';
    stageUrl.value = '';
    stageRefs.value = '';
  };
  stageUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') stage();
  });

  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.reviews',
    { role: 'dialog', 'aria-label': 'Review room' },
    h('header', {}, h('h2', {}, '🎬 Review room'), close),
    h('p.review-intro', {}, 'One staged link per take; takes of one series stack as versions, and every pipeline move carries its evidence. “Approved” is a verdict — only “released” means it’s out. Verdicts and reasons stay with the deliverable in review history and go back to the worker that staged it.'),
    list,
    doneWrap,
    h('footer.review-stage-form', {}, h('div.review-stage-row', {}, stageTitle, stageUrl), h('div.review-stage-row', {}, stageGroup, stageGroups, stageRefs), h('div.review-stage-row', {}, h('button.btn', { type: 'button', onclick: stage }, 'Stage a link'))),
  );

  const repaint = () => {
    const { items, pending } = store.reviews;
    const groups = [...new Set(items.map((i) => i.group).filter((g): g is string => !!g))].sort();
    stageGroups.replaceChildren(...groups.map((g) => h('option', { value: g })));
    list.replaceChildren();
    const waiting = items.filter((i) => i.status === 'pending');
    if (!waiting.length) list.append(h('p.empty', {}, pending ? 'Loading…' : 'Nothing waiting. Workers finishing creative work stage their one link here — or stage one yourself below.'));
    // A series' takes stack newest first, under one header — keyed by project and series, so two
    // projects' "homepage hero" never merge; a take from before floor scoping says so honestly.
    const solo: ReviewItem[] = [];
    const grouped = new Map<string, { group: string; floorId?: string; takes: ReviewItem[] }>();
    for (const item of waiting) {
      if (!item.group) {
        solo.push(item);
        continue;
      }
      const key = `${item.floorId ?? ''}${item.group}`;
      const bucket = grouped.get(key) ?? grouped.set(key, { group: item.group, floorId: item.floorId, takes: [] }).get(key)!;
      bucket.takes.push(item);
    }
    for (const item of solo) list.append(pendingCard(net, item, repaint));
    const scope = (floorId: string | undefined) =>
      floorId === store.floor ? '' : floorId ? ` · ${store.floors.find((f) => f.id === floorId)?.name ?? 'another project'}` : ' · earlier — project unknown';
    const buckets = [...grouped.values()].sort((a, b) => Number(b.floorId === store.floor) - Number(a.floorId === store.floor));
    for (const { group, floorId, takes } of buckets) {
      takes.sort((a, b) => b.at - a.at);
      list.append(h('h3.review-group', {}, `🎬 ${group}`, scope(floorId) ? h('span.review-meta', {}, scope(floorId)) : null), ...takes.map((item) => pendingCard(net, item, repaint)));
    }
    const resolved = items.filter((i) => i.status !== 'pending');
    done.replaceChildren();
    doneWrap.classList.toggle('hidden', !resolved.length);
    doneWrap.querySelector('summary')!.textContent = `Decided (${resolved.length})`;
    for (const item of resolved) done.append(resolvedCard(net, item));
  };

  const onMessage = (msg: ServerMsg) => {
    if (el.isConnected && msg.t === 'reviews') repaint();
  };
  net.onMessage(onMessage);
  const off = store.on('reviews', repaint);
  const modal = openModal(el, {
    doing: '🎬 reviewing staged work',
    onClose: () => off(),
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'reviews.get' });
  repaint();
}
