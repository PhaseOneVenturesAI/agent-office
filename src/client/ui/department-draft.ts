import type { DeptBriefRev } from '../../shared/protocol';

/** The source revision and the submitted snapshot travel with the user's current typing. */
export interface BriefDraft {
  text: string;
  base: number;
  saving?: string;
}

export function acknowledgeBriefDraft(draft: BriefDraft, landed?: DeptBriefRev): BriefDraft | undefined {
  if (!draft.saving || !landed || landed.rev <= draft.base || landed.text !== draft.saving) return draft;
  if (draft.text.trim() === draft.saving) return undefined;
  // The submitted snapshot landed, but the user typed more before its acknowledgment.
  // Keep those edits against the acknowledged revision; do not silently lose them.
  return { text: draft.text, base: landed.rev };
}
