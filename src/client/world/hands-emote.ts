import * as THREE from 'three';
import { EMOTE_BY_ID, type Emote, type EmoteId } from '../../shared/emotes';
import { emoteEnvelope } from './character';
import type { Hands } from './hands';

/**
 * Your hands' half of an emote (see Hands.emote): a wave, a thumbs up, the six seven… posed in
 * front of your eyes over wherever the hands already were. One-shots run for their seconds; a
 * dance (a loop) runs until it's stopped, and moving cancels the whole emote either way.
 */
export class HandEmotes {
  private emoting: { emote: Emote; t: number } | null = null;

  constructor(private hands: Hands) {}

  /** Starts emote `id` (replacing what's playing); an unknown id stops the hands' emote. */
  start(id: EmoteId) {
    const emote = EMOTE_BY_ID.get(id);
    this.emoting = emote ? { emote, t: 0 } : null;
    this.hands.thumbUp.visible = id === 'thumbs';
    const finger = this.hands.right.finger;
    if (finger) finger.visible = id === 'point' && this.hands.costume !== 'halloween' && this.hands.costume !== 'christmas';
  }

  /** The emote is over (it ran its course, or moving cancelled it): the hands go back to whatever they held. */
  stop() {
    this.emoting = null;
    this.hands.thumbUp.visible = false;
    if (this.hands.right.finger) this.hands.right.finger.visible = false;
  }

  /** Moves the hands (already placed for this frame) through the emote. */
  step(dt: number, l: THREE.Group) {
    const e = this.emoting;
    if (!e) return;
    e.t += dt;
    const u = e.t;
    const { seconds, id } = e.emote;
    // A loop (a dance) runs until stop(); a one-shot is over after its seconds.
    if (!e.emote.loop && u >= seconds) return this.stop();
    // A loop eases in and holds; a one-shot eases out again at the end.
    const k = e.emote.loop ? emoteEnvelope(Math.min(u, 0.18), 1) : emoteEnvelope(u, seconds);
    const r = this.hands.right.group;
    this.hands.classic(this.hands.right, k);
    this.hands.classic(this.hands.left, k);
    switch (id) {
      case 'wave':
        // Up in front of your shoulder (in from the edge, clear of the sidebar), rocking side to side.
        r.position.x += (-0.09 + Math.sin(u * 12) * 0.035) * k;
        r.position.y += 0.2 * k;
        r.rotation.x += 0.9 * k;
        r.rotation.z += Math.sin(u * 12) * 0.35 * k;
        break;
      case 'thumbs':
        // Up in front of you, fist level and thumb up, with a little pump.
        r.position.x -= 0.13 * k;
        r.position.y += (0.12 + Math.exp(-u * 3) * Math.sin(u * 14) * 0.03) * k;
        r.rotation.z += 0.25 * k;
        break;
      case 'down':
        // Low in front of you, sinking, with a slow shake of the fist.
        r.position.x -= 0.13 * k;
        r.position.y += (-0.02 - Math.min(u, 1) * 0.06 + Math.sin(u * 7) * 0.012) * k;
        r.rotation.z += 0.2 * k;
        break;
      case 'clap': {
        const c = 0.5 - 0.5 * Math.cos(u * 19);
        for (const [g, side] of [
          [r, 1],
          [l, -1],
        ] as const) {
          g.position.x -= side * (0.1 + 0.085 * c) * k;
          g.position.y += 0.06 * k;
          g.rotation.z += side * 0.9 * k;
        }
        break;
      }
      case 'dance': {
        // Up and down by turns, two beats a second.
        const s = Math.sin(u * Math.PI * 2);
        r.position.y += (0.1 + 0.1 * s) * k;
        l.position.y += (0.1 - 0.1 * s) * k;
        r.position.x += s * 0.03 * k;
        l.position.x += s * 0.03 * k;
        break;
      }
      case 'spin': {
        // Both hands up in a V, swaying as you twirl.
        const s = Math.sin(u * Math.PI * 2);
        r.position.y += (0.2 + s * 0.04) * k;
        l.position.y += (0.2 - s * 0.04) * k;
        r.position.x -= 0.1 * k;
        l.position.x += 0.1 * k;
        break;
      }
      case 'sixseven': {
        // Both palms up at chest height, bobbing alternately like weighing scales.
        const b = Math.sin(u * 7);
        r.position.y += (0.1 + b * 0.055) * k;
        l.position.y += (0.1 - b * 0.055) * k;
        r.position.x -= 0.08 * k;
        l.position.x += 0.08 * k;
        break;
      }
      case 'shrug': {
        // Both hands up beside you, palms open, lifting and dropping.
        const b = Math.sin(u * 6);
        r.position.y += (0.14 + b * 0.03) * k;
        l.position.y += (0.14 - b * 0.03) * k;
        r.position.x -= (0.12 + b * 0.02) * k;
        l.position.x += (0.12 - b * 0.02) * k;
        r.rotation.z += 0.6 * k;
        l.rotation.z -= 0.6 * k;
        break;
      }
      case 'laugh':
        // Hands to the belly, shoulders bouncing, head back (out of view, the bounce says it).
        r.position.x -= 0.08 * k;
        r.position.y += (-0.06 + Math.abs(Math.sin(u * 10)) * 0.02) * k;
        r.position.z -= 0.14 * k;
        l.position.x += 0.08 * k;
        l.position.y += (-0.06 + Math.abs(Math.sin(u * 10)) * 0.02) * k;
        l.position.z -= 0.14 * k;
        break;
      case 'point': {
        // Out toward the crosshair, like a reach you hold.
        const jab = 1 + Math.exp(-u * 4) * Math.sin(u * 16) * 0.15;
        r.position.x -= 0.16 * k;
        r.position.y += 0.09 * k;
        r.position.z -= 0.2 * k * jab;
        r.rotation.x += 0.3 * k;
        r.rotation.y += 0.15 * k;
        break;
      }
      case 'facepalm':
        // Palm up to your face, covering a corner of the view.
        r.position.x -= 0.12 * k;
        r.position.y += (0.17 + Math.sin(u * 5) * 0.01) * k;
        r.position.z += 0.2 * k;
        r.rotation.x += 0.9 * k;
        break;
    }
  }
}
