// The office's harness: the instruction and skill files every worker runs with (see
// server/harness.ts). Admins read and edit them from the office, then push them into every
// account's sign-in home. Only explicit shared defaults and skill files are pushed.
import type { HarnessHistoryPage, HarnessSnapshot, HarnessSource } from './harness-history.js';

export interface HarnessFile {
  /** Its path inside the harness root, POSIX style. */
  path: string;
  size: number;
  mtime: number;
  status?: 'present' | 'missing' | 'unavailable';
}

export interface HarnessState {
  /** Where it lives on the office's machine. */
  root: string;
  host?: string;
  files: HarnessFile[];
  /** When the files were last pushed into everyone's sign-in homes, by whom, into how many. */
  applied?: { by: string; at: number; homes: number };
  /** Why reading the harness failed, when it did. */
  error?: string;
}

export type HarnessClientMsg =
  /** The list of files (admins only). */
  | { t: 'harness.get' }
  /** One file's text. */
  | { t: 'harness.read'; path: string; request?: string }
  /** Replace one source only with an explicit hash base; prior text is retained. */
  | { t: 'harness.write'; path: string; text: string; base: string; request: string }
  | { t: 'harness.history'; path: string; before?: string; request: string }
  | { t: 'harness.snapshot'; path: string; revision: string; request: string }
  | { t: 'harness.restore'; path: string; revision: string; base: string; request: string }
  /** Push the harness into the office's and every account's agent homes (admins only). */
  | { t: 'harness.apply' }
  /** Whether pushes skip you: you run a harness of your own (accounts only). */
  | { t: 'harness.optget' }
  /** Run your own harness (true) or come back to the office's (false). */
  | { t: 'harness.opt'; out: boolean };

export type HarnessServerMsg =
  /** The list of files, whenever it changes and when asked. */
  | { t: 'harness'; state: HarnessState }
  /** One file's text, as asked. */
  | { t: 'harness.file'; path: string; text?: string | null; revision?: string; status?: HarnessSource['status']; error?: string; request?: string }
  | { t: 'harness.result'; path: string; request: string; file?: HarnessSource; history?: HarnessHistoryPage; snapshot?: HarnessSnapshot; error?: string; warning?: string }
  /** Whether harness pushes skip you, when asked and whenever you change it. */
  | { t: 'harness.opt'; out: boolean };
