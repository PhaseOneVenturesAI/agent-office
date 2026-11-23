// Each account's own harness (see server/personal-harness.ts): a person on their own harness keeps
// instructions and skills of their own, edits them in ☰ → 🧰 Harness and applies them to their own
// agent homes only. Every message acts on the sender's own account; none names another.
import type { HarnessFile } from './harness.js';
import type { HarnessHistoryPage, HarnessSnapshot, HarnessSource } from './harness-history.js';

export interface PersonalHarnessState {
  /** office: the office's pushes reach your agents. own: they skip you, and you apply this one. */
  mode: 'office' | 'own';
  /** Where it lives on the office's machine. */
  root: string;
  files: HarnessFile[];
  /** When you last applied it to your agent homes, and into how many. */
  applied?: { at: number; homes: number };
  error?: string;
}

export type PersonalHarnessClientMsg =
  /** Your mode and your files. */
  | { t: 'harness.own.get' }
  /** Use your own harness (true) or the office's (false); the same switch as in 🔐 Your sign-ins. */
  | { t: 'harness.own.mode'; own: boolean }
  | { t: 'harness.own.read'; path: string; request?: string }
  | { t: 'harness.own.write'; path: string; text: string; base: string; request: string }
  | { t: 'harness.own.history'; path: string; before?: string; request: string }
  | { t: 'harness.own.snapshot'; path: string; revision: string; request: string }
  | { t: 'harness.own.restore'; path: string; revision: string; base: string; request: string }
  /** A new file in your harness. */
  | { t: 'harness.own.create'; path: string; text: string; request: string }
  /** Copy the office's CLAUDE.md, WORKFLOW.md, AGENTS.md and skills/ in, keeping any you have. */
  | { t: 'harness.own.seed' }
  /** Push your harness into your own Claude, Kimi and Codex homes. */
  | { t: 'harness.own.apply' };

export type PersonalHarnessServerMsg =
  | { t: 'harness.own'; state: PersonalHarnessState }
  | { t: 'harness.own.file'; path: string; text?: string | null; revision?: string; status?: HarnessSource['status']; error?: string; request?: string }
  | { t: 'harness.own.result'; path: string; request: string; file?: HarnessSource; history?: HarnessHistoryPage; snapshot?: HarnessSnapshot; error?: string; warning?: string };
