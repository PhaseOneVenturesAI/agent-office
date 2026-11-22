import './reviews.css';
import type { ReviewGate, ReviewItem, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

const gateBadge = (gate: ReviewGate | undefined) =>
  gate === 'passed' ? h('span.review-gate.passed', {}, 'gate passed') : gate === 'failed' ? h('span.review-gate.failed', {}, 'gate failed') : null;

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
      h('a.review-title', { href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url }, `“${item.title}” ↗`),
      gateBadge(item.gate),
    ),
    h('p.review-meta', {}, `staged by ${item.by} · ${timeAgo(item.at)}`),
    item.note ? h('p.review-note', {}, item.note) : null,
    h(
      'div.review-decide',
      {},
      reason,
      h('button.btn.primary', { type: 'button', onclick: () => decide(true) }, '✅ Accept'),
      h('button.btn.danger', { type: 'button', onclick: () => decide(false) }, '❌ Reject'),
    ),
  );
}

/** A decided one, collapsed to a line: the mark, the link, who and why. */
function resolvedCard(item: ReviewItem) {
  const mark = item.status === 'accepted' ? '✅' : '❌';
  return h(
    'article.review-card.resolved',
    {},
    h(
      'header',
      {},
      h('span.review-mark', {}, mark),
      h('a.review-title', { href: item.url, target: '_blank', rel: 'noopener noreferrer', title: item.url }, `“${item.title}” ↗`),
      h('span.review-meta', {}, `${item.status} by ${item.verdict?.by ?? '?'} · ${timeAgo(item.verdict?.at ?? item.at)}`),
    ),
    item.verdict?.reason ? h('p.review-note', {}, `“${item.verdict.reason}”`) : null,
  );
}

/**
 * 🎬 Review Room: the quality loop, in one place. Workers finishing creative tasks stage their one
 * link here; you accept or reject with a one-line reason. Every verdict is appended to the
 * harness's review ratchet, so the next worker starts from what was learned, and a worker that
 * staged the link hears the verdict in its terminal (see server/reviews.ts).
 */
export function openReviews(net: Net) {
  const list = h('div.review-list');
  const done = h('div.review-list');
  const doneWrap = h('details.review-done', {}, h('summary', {}, 'Decided'), done);

  // Staging a link by hand, for when the thing to look at didn't come from a worker.
  const stageTitle = h('input.review-stage-title', { type: 'text', placeholder: 'What it is, short', maxlength: '120' }) as HTMLInputElement;
  const stageUrl = h('input.review-stage-url', { type: 'url', placeholder: 'https://…', maxlength: '500' }) as HTMLInputElement;
  const stage = () => {
    const title = stageTitle.value.trim();
    const url = stageUrl.value.trim();
    if (!title || !url) {
      (title ? stageUrl : stageTitle).focus();
      return;
    }
    net.send({ t: 'reviews.submit', title, url });
    stageTitle.value = '';
    stageUrl.value = '';
  };
  stageUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') stage();
  });

  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.reviews',
    { role: 'dialog', 'aria-label': 'Review room' },
    h('header', {}, h('h2', {}, '🎬 Review room'), close),
    h('p.review-intro', {}, 'One staged link per take. Your verdict — and its one-line reason — goes straight into the harness’s review ratchet, so every worker starts from what you taught it, and back to the worker that staged it.'),
    list,
    doneWrap,
    h('footer', {}, stageTitle, stageUrl, h('button.btn', { type: 'button', onclick: stage }, 'Stage a link')),
  );

  const repaint = () => {
    const { items, pending } = store.reviews;
    list.replaceChildren();
    const waiting = items.filter((i) => i.status === 'pending');
    if (!waiting.length) list.append(h('p.empty', {}, pending ? 'Loading…' : 'Nothing waiting. Workers finishing creative work stage their one link here — or stage one yourself below.'));
    for (const item of waiting) list.append(pendingCard(net, item, repaint));
    const resolved = items.filter((i) => i.status !== 'pending');
    done.replaceChildren();
    doneWrap.classList.toggle('hidden', !resolved.length);
    doneWrap.querySelector('summary')!.textContent = `Decided (${resolved.length})`;
    for (const item of resolved) done.append(resolvedCard(item));
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
