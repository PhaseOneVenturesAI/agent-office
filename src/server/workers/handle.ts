import type { Worker, WorkerHandle } from './types.js';

type Actions = Pick<WorkerHandle, 'setStatus' | 'emit' | 'persist' | 'notePrompt' | 'noteTool' | 'notePr' | 'clearTask' | 'scheduleScan' | 'prompt' | 'assistant'>;

/** Provider view of its worker: getters stay live without exposing the manager. */
export function makeWorkerHandle(w: Worker, actions: Actions): WorkerHandle {
  return {
      get info() {
        return w.info;
      },
      get state() {
        return w.state;
      },
      get running() {
        return !!w.pty;
      },
      get bootBlocked() {
        return !!w.bootBlocked;
      },
      set bootBlocked(v) {
        w.bootBlocked = v;
      },
      get leftNeedsInputAt() {
        return w.leftNeedsInputAt;
      },
      set leftNeedsInputAt(v) {
        w.leftNeedsInputAt = v;
      },
      get failStreak() {
        return w.failStreak;
      },
      set failStreak(v) {
        w.failStreak = v;
      },
      get tracker() {
        return w.tracker;
      },
      get pendingPrompt() {
        return w.pendingPrompt;
      },
      set pendingPrompt(v) {
        w.pendingPrompt = v;
      },
    get assistantHome() { return w.assistantHome; },
    set assistantHome(v) { w.assistantHome = v; },
    ...actions,
  };
}
