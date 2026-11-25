// Who a worker is shared with. Private by default: only the owner (and the office's admins) see a
// worker nobody is shared with. The people picker at hire time and the 👥 control on its card and
// terminal header both come from here, as does the coworker directory they list (worker.people).
import './share.css';
import type { Net } from '../net';
import type { ServerMsg, WorkerInfo } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal } from './dom';

export interface Person {
  id: string;
  name: string;
}

interface Directory {
  /** Your own account id, to leave yourself out of the picker. */
  you?: string;
  people: Person[];
}

let net: Net | null = null;
let directory: Directory | null = null;
let asking: Promise<Directory> | null = null;
const watchers = new Set<() => void>();

/** The 3D office and the 2D view each hand over their connection once, as they start. */
export function initShare(n: Net) {
  net = n;
}

/** Feeds the module its coworker directory; wire it into the message routing (worker.people). */
export function routeShareMessage(msg: ServerMsg) {
  if (msg.t !== 'worker.people') return;
  directory = { you: msg.you, people: msg.people };
  asking = null;
  for (const fn of watchers) fn();
}

/** Runs `fn` whenever the coworker directory arrives, so a 👥 control drawn before then can show up. */
export function onPeople(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/** The office's accounts, asked for once; empty when the office has none (the shared password: nothing to share between). */
export function loadPeople(): Promise<Directory> {
  if (directory) return Promise.resolve(directory);
  if (asking) return asking;
  const n = net;
  if (!n) return Promise.resolve({ people: [] });
  asking = new Promise<Directory>((resolve) => {
    const give = () => {
      clearTimeout(timer);
      watchers.delete(give);
      resolve(directory ?? { people: [] });
    };
    // Never answered (still connecting, say): empty now, asked again next time.
    const timer = setTimeout(() => {
      watchers.delete(give);
      asking = null;
      resolve({ people: [] });
    }, 5000);
    watchers.add(give);
    n.send({ t: 'worker.people' });
  });
  return asking;
}

/** Whether you may change who `w` is shared with: its owner, or an admin. */
export function canShareWorker(w: WorkerInfo): boolean {
  if (!directory?.people.length) return false;
  return store.me.admin || (!!w.owner && w.owner === directory.you);
}

/** Ask for the directory when there are accounts to share with and it isn't in yet (a 👥 control waits on it). */
export function wantPeople(workers: Iterable<WorkerInfo>) {
  if (!directory && [...workers].some((w) => w.owner)) void loadPeople();
}

/**
 * The 👥 picker of coworkers to share a new worker with, nobody picked by default (private). Renders
 * nothing in an office without accounts. `value()` is the picked account ids.
 */
export function peoplePicker(selected: string[] = []): { element: HTMLElement; value(): string[] } {
  const boxes = new Map<string, HTMLInputElement>();
  const element = h('div.share-picks.hidden', { role: 'group', 'aria-label': 'Coworkers to share with' });
  void loadPeople().then((d) => {
    // No account of your own (the shared password): you're an admin, and there's nothing to share from.
    const others = d.you ? d.people.filter((p) => p.id !== d.you) : [];
    if (!others.length) return;
    element.classList.remove('hidden');
    element.append(
      h('span', { title: 'They can see its card and terminal and type into it. Nobody picked: only you and the admins can.' }, '👥 Share with'),
      ...others.map((p) => {
        const box = h('input', { type: 'checkbox', value: p.id }) as HTMLInputElement;
        box.checked = selected.includes(p.id);
        boxes.set(p.id, box);
        return h('label.repo-pick', { title: `${p.name} can see this worker's terminal and take it over (type into it)` }, box, p.name);
      }),
    );
  });
  return { element, value: () => [...boxes].filter(([, b]) => b.checked).map(([id]) => id) };
}

/** The 👥 control on a worker's card or terminal header: who it's shared with, editable by its owner (or an admin). */
export function openShare(w: WorkerInfo) {
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const save = h('button.btn.primary', { type: 'submit' }, 'Save');
  const picker = peoplePicker(w.sharedWith ?? []);
  const form = h(
    'form.modal.share',
    { role: 'dialog', 'aria-label': `Who can see ${w.name}` },
    h('header', {}, h('h2', {}, `👥 ${w.name}`), close),
    h(
      'div.body',
      {},
      h('p', { style: 'margin:0 0 10px;font-weight:700' }, `Picked coworkers can see ${w.name}'s card and terminal, and take it over by typing into it. Nobody picked: only you and the office's admins can.`),
      picker.element,
    ),
    h('footer', {}, h('span.grow'), save),
  ) as HTMLFormElement;
  const modal = openModal(form);
  close.addEventListener('click', () => modal.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    net?.send({ t: 'worker.share', workerId: w.id, with: picker.value() });
    modal.close();
  });
}
