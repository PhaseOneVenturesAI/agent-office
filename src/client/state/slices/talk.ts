import type { Slice } from '../store';
import type { HQTalkView } from '../../../shared/protocol/hq';
declare module '../store' {
  interface Store { leadTalk?: HQTalkView }
  interface Topics { leadTalk: true }
}
export const talk: Slice = {
  init(s) { s.leadTalk = undefined; },
  on: { 'hq.leads'(s, m) { s.leadTalk = m.view; return ['leadTalk']; }, me(s) { s.leadTalk = undefined; return ['leadTalk']; } },
  enter(s) { s.leadTalk = undefined; return ['leadTalk']; },
};
