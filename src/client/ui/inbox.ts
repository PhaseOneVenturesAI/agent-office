import './inbox.css';
import type { WorkerInfo } from '../../shared/protocol';
import { waitingInOrder } from '../nextup';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

/** What the inbox needs from the office around it, so it stays a window and nothing more. */
export interface InboxDeps {
  /** Over to the worker's desk with its terminal open, answering it. */
  answerWorker(id: string): void;
  /** Ride to another floor. */
  ride(floorId: string): void;
}

const what = (w: WorkerInfo) => w.task?.name ?? w.prompt?.split('\n')[0] ?? '';
const how = (w: WorkerInfo) => w.task?.summary ?? w.activity ?? '';

/** One card: who it is, what it's on, why it's here, and the button that takes you straight to it. */
function workerCard(w: WorkerInfo, act: string, run: () => void) {
  return h(
    'article.inbox-card',
    { role: 'button', tabindex: '0', onclick: run, onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && run() },
    h(
      'header',
      {},
      h('span.inbox-dot', { class: w.status === 'needs_input' ? 'needs' : 'done' }),
      h('strong', {}, w.name),
      h('span.inbox-meta', {}, `waiting ${timeAgo(w.waitingSince ?? w.createdAt)}`),
      h('span.grow'),
      h('button.btn.primary.small', { type: 'button' }, act),
    ),
    what(w) ? h('p.inbox-what', {}, what(w)) : null,
    how(w) && how(w) !== what(w) ? h('p.inbox-how', {}, how(w)) : null,
  );
}

/**
 * 📥 Needs me: the attention inbox. Everything waiting on you in one list, and every card takes
 * you straight to the thing: a worker that needs an answer (desk, terminal open at the question),
 * a finished one (its terminal), or a floor where
 * someone's waiting (the ride there). Nothing here is a dead notification.
 */
export function openInbox(deps: InboxDeps) {
  const list = h('div.inbox-list');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.inbox', { role: 'dialog', 'aria-label': 'Needs me' }, h('header', {}, h('h2', {}, '📥 Needs me'), close), list);
  const offs: (() => void)[] = [];
  const modal = openModal(el, {
    doing: '📥 going through what needs you',
    onClose: () => {
      for (const off of offs) off();
    },
  });
  close.addEventListener('click', () => modal.close());

  const repaint = () => {
    if (!el.isConnected) return;
    const waiting = waitingInOrder(store.workers.values());
    const needs = waiting.filter((w) => w.status === 'needs_input');
    const done = waiting.filter((w) => w.status === 'done');
    const floors = store.floors.filter((f) => f.id !== store.floor && f.waiting > 0);
    list.replaceChildren();
    if (!waiting.length && !floors.length) {
      list.append(h('p.empty', {}, '👍 Nothing needs you. Workers that stop with a question, or finish a take land here.'));
      return;
    }
    for (const w of needs) {
      list.append(workerCard(w, 'Answer', () => {
        modal.close();
        deps.answerWorker(w.id);
      }));
    }
    for (const w of done) {
      list.append(workerCard(w, 'See it', () => {
        modal.close();
        deps.answerWorker(w.id);
      }));
    }
    for (const f of floors) {
      list.append(
        h(
          'article.inbox-card',
          { role: 'button', tabindex: '0', onclick: () => {
            modal.close();
            deps.ride(f.id);
          } },
          h('header', {}, h('span.inbox-dot.floor'), h('strong', {}, `${f.name} floor`), h('span.inbox-meta', {}, `${f.waiting} waiting there`), h('span.grow'), h('button.btn.small', { type: 'button' }, '🛗 Ride over')),
        ),
      );
    }
  };

  offs.push(...(['workers', 'floors'] as const).map((t) => store.on(t, repaint)));
  repaint();
}
