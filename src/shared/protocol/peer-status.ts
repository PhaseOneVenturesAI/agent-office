// Your status over your character's head (see PeerInfo.status and shared/peer-status.ts). Everyone hears
// about it as a peer.update.

import type { PeerStatus } from '../peer-status.js';

export type StatusClientMsg =
  /** Put a status up (an emoji, a few words or both), or take it down (null). */
  { t: 'status'; status: PeerStatus | null };
