// The office's harness: the instruction and skill files every worker runs with (see
// server/harness.ts). Admins read and edit them from the office, then push them into every
// account's sign-in home. Only explicit shared defaults and skill files are pushed.

export interface HarnessFile {
  /** Its path inside the harness root, POSIX style. */
  path: string;
  size: number;
  mtime: number;
}

export interface HarnessState {
  /** Where it lives on the office's machine. */
  root: string;
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
  | { t: 'harness.read'; path: string }
  /** Replace one file's text (admins only; the old text is kept as <file>.bak). */
  | { t: 'harness.write'; path: string; text: string }
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
  | { t: 'harness.file'; path: string; text?: string; error?: string }
  /** Whether harness pushes skip you, when asked and whenever you change it. */
  | { t: 'harness.opt'; out: boolean };
