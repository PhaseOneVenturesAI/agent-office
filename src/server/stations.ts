// What the office's three leads are told when they're hired: the Product, Development and Marketing
// leads standing by the boards (STATIONS in shared/layout.ts). Whoever walks up types them a request;
// the first one follows this brief in the same prompt. The briefs themselves are prompts the office can
// rewrite in ⚙️ Settings (shared/prompts.ts).

import type { StationKind } from '../shared/layout.js';
import { officePrompt, type PromptSource } from './prompts.js';

export function stationBrief(kind: StationKind, prompts?: PromptSource): string {
  return officePrompt(prompts, `station.${kind}`);
}

/** The development lead gets a worktree of its own to write code in; the others stand in the shared checkout. */
export function stationWorktree(kind: StationKind): boolean {
  return kind === 'development';
}

/**
 * Claude Code tools a lead in the shared checkout is launched without, so it can't edit those files even
 * by mistake: it hires a worker or queues a task for that instead.
 */
export const READ_ONLY_LEAD_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** The tools `kind` is launched without, if any. */
export function stationDisallowedTools(kind: StationKind): string[] {
  return stationWorktree(kind) ? [] : READ_ONLY_LEAD_DISALLOWED_TOOLS;
}
