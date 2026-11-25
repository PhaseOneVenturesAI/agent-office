// One cubby as the hall shows it: its front (clear glass for yours, frosted for anyone else's, an open
// doorway for yours and a free one), the dark sign pill over the door with its lamp, the shapes moving
// behind frosted glass, and the door you walk up to. Inside your own is the Interior (interior.ts);
// nobody else's inside is ever built, and the server never sends it.

import * as THREE from 'three';
import type { CubbyInfo } from '../../../shared/protocol/cubbies';
import { textPlane } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import { Interior, type Focus } from './interior';
import { DOOR_WIDTH, FRONT_HEIGHT, colliderOf, faceOf, signText, usableAt, type CubbyFace, type CubbyIt, type CubbyPlacement } from './model';
import { CREAM, INK, disposeTree, front, lampDot, silhouette } from './props';

export class CubbyRoom {
  readonly group = new THREE.Group();
  private shell = new THREE.Group();
  private sign: THREE.Mesh | null = null;
  private signKey = '';
  private dot = lampDot();
  private face: CubbyFace | null = null;
  private shapes: THREE.Group[] = [];
  private frontColliders: Collider[] = [];
  readonly door: CubbyIt;
  interior: Interior | null = null;
  /** The cubby in this slot, as last synced (undefined: a free slot). */
  info: CubbyInfo | undefined;

  constructor(readonly place: CubbyPlacement) {
    const { x, z, rotY, depth } = place;
    this.group.position.set(x, place.y ?? 0, z);
    this.group.rotation.y = rotY;
    this.group.add(this.shell);
    this.group.add(this.dot.mesh);
    this.door = usableAt(place, 'cubbydoor', 0, depth / 2 + 0.7, 1.3);
    this.group.userData.cubbySlot = place.slot;
  }

  /** Takes in the cubby in this slot now (or none); true when what you can bump into changed. */
  sync(info: CubbyInfo | undefined, ownerName: string): boolean {
    this.info = info;
    if (info) this.door.cubbyId = info.id;
    else delete this.door.cubbyId;
    let changed = false;
    const face = faceOf(info);
    if (face !== this.face) {
      this.face = face;
      this.buildFront(face);
      changed = true;
    }
    this.paintSign(info);
    this.dot.set(info ? info.lamp : null);
    // Shapes behind someone else's frosted glass: how many are working, never who or what.
    const shapes = face === 'other' && info && info.lamp !== 'asleep' ? Math.min(3, Math.max(0, info.working | 0)) : 0;
    this.setShapes(shapes);
    // The inside: only your own, only once your computer has sent it.
    const interior = face === 'mine' && info?.interior ? info.interior : null;
    if (interior && !this.interior) {
      this.interior = new Interior(this.place);
      this.group.add(this.interior.group);
      changed = true;
    } else if (!interior && this.interior) {
      this.dropInterior();
      changed = true;
    }
    if (interior && info && this.interior) this.interior.sync(info.id, interior, info.lamp, ownerName);
    return changed;
  }

  private buildFront(face: CubbyFace) {
    disposeTree(this.shell);
    this.shell.clear();
    const { width: w, depth: d } = this.place;
    this.frontColliders = [];
    if (this.place.front === false) return;
    // Someone else's has its door shut: frosted all the way across, and you can't walk in.
    const door = face === 'other' ? 0 : DOOR_WIDTH;
    const glass = front(w, FRONT_HEIGHT, door, face === 'other');
    glass.position.z = d / 2;
    this.shell.add(glass);
    const side = (w - door) / 2;
    const T = 0.08;
    if (door) {
      this.frontColliders.push(colliderOf(this.place, -w / 2 + side / 2, d / 2, side / 2, T, FRONT_HEIGHT));
      this.frontColliders.push(colliderOf(this.place, w / 2 - side / 2, d / 2, side / 2, T, FRONT_HEIGHT));
    } else this.frontColliders.push(colliderOf(this.place, 0, d / 2, w / 2, T, FRONT_HEIGHT));
  }

  private paintSign(info: CubbyInfo | undefined) {
    const text = signText(info);
    const key = `${text}|${!info}`;
    if (key === this.signKey) return;
    this.signKey = key;
    if (this.sign) {
      this.group.remove(this.sign);
      disposeTree(this.sign);
    }
    // The office's dark sign pill; a free cubby's is cream, so it reads as an invitation.
    const sign = textPlane(text, info ? { bg: INK, color: CREAM, size: 44, border: CREAM } : { bg: CREAM, color: INK, size: 44 });
    sign.scale.setScalar(0.9);
    sign.position.set(0, FRONT_HEIGHT + 0.42, this.place.depth / 2 + 0.09);
    this.group.add(sign);
    this.sign = sign;
    const half = ((sign.geometry.parameters.width as number) * 0.9) / 2;
    this.dot.mesh.position.set(half + 0.2, FRONT_HEIGHT + 0.42, this.place.depth / 2 + 0.12);
  }

  private setShapes(n: number) {
    while (this.shapes.length > n) this.group.remove(this.shapes.pop()!);
    while (this.shapes.length < n) {
      const s = silhouette();
      s.position.set(-0.9 + this.shapes.length * 0.9, 0, -0.2);
      this.group.add(s);
      this.shapes.push(s);
    }
  }

  private dropInterior() {
    if (!this.interior) return;
    this.group.remove(this.interior.group);
    this.interior.dispose();
    this.interior = null;
  }

  /** What you bump into here. */
  colliders(): Collider[] {
    return this.interior ? [...this.frontColliders, ...this.interior.colliders] : this.frontColliders;
  }

  /** What there is to use here: the door, and inside your own, the lead, the computer and every helper. */
  usables(): Interactable[] {
    return this.interior ? [this.door, ...this.interior.usables] : [this.door];
  }

  update(dt: number, t: number, now: number, focus?: Focus) {
    for (const [i, s] of this.shapes.entries()) {
      s.position.x = -0.9 + i * 0.9 + Math.sin(t * 0.35 + i * 2.1) * 0.35;
      s.position.z = -0.3 + Math.cos(t * 0.27 + i) * 0.25;
    }
    this.interior?.update(dt, t, now, focus);
  }

  dispose() {
    this.dropInterior();
    disposeTree(this.group);
    this.group.clear();
  }
}
