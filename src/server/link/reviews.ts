import type { LeadSend } from '../../shared/protocol/lead-talk.js';
import { localDesign } from '../cubbies/local/design.js';
import { appendFeedback } from '../cubbies/local/feedback.js';
import { localPitch } from '../cubbies/local/pitch.js';
import { appendVerdict } from '../cubbies/local/pitch-feedback.js';
import { LeadError } from '../cubbies/local/lead.js';
/** Called only by LeadTalk after the authenticated connector and local target resolution. */
export function saveReview(frame: LeadSend, project: string | undefined) {
  const review = frame.review;
  if (!review) return;
  if (!project || 'cofounder' in frame.target) throw new LeadError('Reviews need a registered project');
  try {
    if (review.kind === 'draft') {
      const { boards } = localDesign(project);
      appendFeedback(project, boards, review.cardId, { id: review.requestId, text: review.text, at: review.at });
    } else {
      const { pitch } = localPitch(project);
      if (!pitch || pitch.version !== review.version) throw Error('Pitch changed');
      appendVerdict(project, pitch, { ...review, source: 'office-link', from: frame.from });
    }
  } catch { throw new LeadError('Could not save review: the card changed, was already reviewed, or its feedback file needs checking'); }
}
