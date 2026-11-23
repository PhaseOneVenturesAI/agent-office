/** The tab's title, the same in the 3D office and the 2D view (/lite). No three.js here: the 2D view imports it. */
import { alertsForMe, waitingOnSomeone } from '../notify';
import { store } from '../state';

/** The tab title counts the workers waiting on someone, on every floor, so you can see them from another tab. Only yours count (see alertsForMe); other floors only say that someone waits. */
export function renderTitle() {
  const name = store.project?.name;
  const elsewhere = store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0);
  const waiting = [...store.workers.values()].filter((w) => waitingOnSomeone(w) && alertsForMe(w, store.me)).length + elsewhere;
  document.title = `${waiting ? `(${waiting}) ` : ''}${name ? `${name} · ` : ''}Agent Office`;
}
