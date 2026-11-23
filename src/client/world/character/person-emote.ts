import * as THREE from 'three';
import type { Emote } from '../../../shared/emotes';
import { emoteEnvelope, popCurve } from './curves';
import type { PersonRig } from './rig';

/** An emote under way (see the Person's `emoting`). */
export interface Emoting {
  emote: Emote;
  t: number;
  pop: THREE.Sprite;
  size: THREE.Vector2;
}

/**
 * Poses the emote over whatever the arms were doing (walking, sitting, a drag on a cigarette),
 * `k` of the way. The dances' bounce and steps only happen with both feet on the floor (`still`).
 * A one-shot ends after its `seconds` and a loop runs until the Person cancels it (it moved, or
 * picked another emote): false once it's over, with nothing posed, for the Person to put it away.
 */
export function poseEmote(rig: PersonRig, e: Emoting, dt: number, still: number, emojiLift: number): boolean {
  e.t += dt;
  const { seconds, id } = e.emote;
  const loop = !!e.emote.loop;
  if (!loop && e.t >= seconds) return false;
  const u = e.t;
  // A loop eases in and holds; a one-shot eases out again at the end.
  const k = loop ? emoteEnvelope(Math.min(u, 0.18), 1) : emoteEnvelope(u, seconds);
  const pose = (arm: THREE.Object3D, x: number, z: number) => {
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, x, k);
    arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, z, k);
  };
  // Forward is +z, so the character's right arm is the one on -x (armL), as in reach.
  switch (id) {
    case 'wave':
      pose(rig.armL, -0.35, -2.55 + Math.sin(u * 12) * 0.35);
      rig.head.rotation.z = -0.1 * k;
      break;
    case 'thumbs':
      // Out in front, with a little pump that settles.
      pose(rig.armL, -1.75 - Math.exp(-u * 3) * Math.sin(u * 14) * 0.25, 0.2);
      rig.head.rotation.z = -0.08 * k;
      break;
    case 'down':
      // Forward but sinking, with a slow disappointed head shake.
      pose(rig.armL, -1.4 + Math.min(u, 1) * 0.4, 0.28);
      rig.head.rotation.y = Math.sin(u * 7) * 0.12 * k;
      rig.head.rotation.z = 0.1 * k;
      break;
    case 'clap': {
      // Both hands out in front, meeting in the middle about three times a second.
      const c = 0.5 - 0.5 * Math.cos(u * 19);
      pose(rig.armL, -1.25, 0.3 + 0.42 * c);
      pose(rig.armR, -1.25, -0.3 - 0.42 * c);
      rig.body.position.y += Math.abs(Math.sin(u * 9.5)) * 0.02 * k * still;
      break;
    }
    case 'shrug':
      // Both hands up at the shoulders, palms open, with a little lift and drop.
      pose(rig.armL, -0.45, -1.75 + Math.sin(u * 6) * 0.12);
      pose(rig.armR, -0.45, 1.75 - Math.sin(u * 6) * 0.12);
      rig.head.rotation.z = 0.12 * k;
      rig.body.position.y += Math.abs(Math.sin(u * 6)) * 0.015 * k * still;
      break;
    case 'laugh':
      // Head thrown back, hands on the belly, shoulders bouncing.
      pose(rig.armL, -1.15, 0.5);
      pose(rig.armR, -1.15, -0.5);
      rig.head.rotation.x += -0.28 * k;
      rig.body.position.y += Math.abs(Math.sin(u * 10)) * 0.02 * k * still;
      break;
    case 'facepalm':
      // Hand to the face, head down and shaking slowly.
      pose(rig.armL, -2.4, 0.62);
      rig.body.rotation.x += 0.1 * k;
      rig.head.rotation.x += 0.3 * k;
      rig.head.rotation.y = Math.sin(u * 5) * 0.15 * k;
      break;
    case 'sixseven': {
      // Both palms up at chest height, bobbing alternately like weighing scales.
      const b = Math.sin(u * 7);
      pose(rig.armL, -1.5 + b * 0.3, -0.5);
      pose(rig.armR, -1.5 - b * 0.3, 0.5);
      rig.head.rotation.z = b * 0.06 * k;
      break;
    }
    case 'dance': {
      // Two beats a second: arms up by turns, a hop on every beat, hips swaying, a knee up.
      const b = u * Math.PI * 2;
      const s = Math.sin(b);
      pose(rig.armL, -0.3, THREE.MathUtils.lerp(-0.35, -2.7, (s + 1) / 2));
      pose(rig.armR, -0.3, THREE.MathUtils.lerp(0.35, 2.7, (1 - s) / 2));
      const m = k * still;
      rig.body.position.y += Math.abs(Math.sin(b)) * 0.08 * m;
      rig.body.rotation.z = s * 0.12 * m;
      rig.body.rotation.y = Math.sin(b / 2) * 0.45 * m;
      rig.legL.rotation.x = THREE.MathUtils.lerp(rig.legL.rotation.x, -Math.max(0, s) * 0.7, m);
      rig.legR.rotation.x = THREE.MathUtils.lerp(rig.legR.rotation.x, -Math.max(0, -s) * 0.7, m);
      rig.head.rotation.z = -s * 0.1 * k;
      break;
    }
    case 'spin': {
      // A celebration twirl: arms in a V overhead, the torso going round, a hop on each beat.
      const m = k * still;
      pose(rig.armL, -0.35, -2.5);
      pose(rig.armR, -0.35, 2.5);
      rig.body.rotation.y = (u * 3.5) % (Math.PI * 2);
      rig.body.position.y += Math.abs(Math.sin(u * Math.PI * 2)) * 0.07 * m;
      rig.head.rotation.z = Math.sin(u * Math.PI * 2) * 0.08 * k;
      break;
    }
    case 'point':
      // Arm straight out at whatever you face, with a jab to start.
      pose(rig.armL, -1.6 - Math.exp(-u * 4) * Math.sin(u * 16) * 0.15, 0.05);
      break;
  }
  // The emoji pops in over their head, rises a little, wobbles, and fades at the end of a one-shot.
  const pop = popCurve(u / 0.3);
  e.pop.scale.set(e.size.x * pop, e.size.y * pop, 1);
  e.pop.position.y = 2.42 + emojiLift + Math.min(u, 1.5) * 0.12;
  e.pop.material.rotation = Math.sin(u * 7) * 0.12;
  e.pop.material.opacity = loop ? 1 : THREE.MathUtils.clamp((seconds - u) / 0.4, 0, 1);
  return true;
}
