import * as THREE from 'three';
import { MEETING_ROOM as R, MEETING_TABLE as T } from '../../../shared/layout';
import { pitchImageUrl, type PitchPiece, type PitchView } from '../../../shared/protocol/pitch';
import { mesh, textPlane, toon } from '../../world/toon';
import { PALETTE } from '../../world/office/materials';
import type { Interactable } from '../../world/types';
import { verdictLabel } from '../../shared/pitch/review';

export interface Station { piece: PitchPiece; group: THREE.Group; face: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; material: THREE.MeshBasicMaterial; width: number; height: number; it: Interactable; index: number }
/** All props fit outside the chairs/door/meeting board; no new movement colliders. */
export class PitchRoom {
  readonly group = new THREE.Group();
  readonly stations: Station[] = [];
  readonly lights: THREE.PointLight[] = [];
  private textures = new Set<THREE.Texture>();
  private owned = new Set<THREE.Material>();
  private generation = 0;
  constructor() { this.group.name = 'pitch-room'; this.group.visible = false; }
  clear() {
    this.generation++;
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const t of this.textures) t.dispose(); this.textures.clear();
    for (const m of this.owned) m.dispose(); this.owned.clear();
    this.group.clear(); this.stations.length = 0; this.lights.length = 0;
  }
  private label(text: string, x: number, y: number, z: number, rotation = 0, width = 2.3) {
    const sign = textPlane(text, { bg: '#fff1de', color: PALETTE.ink, size: 32 });
    const size = sign.geometry.parameters.width;
    sign.scale.setScalar(Math.min(1, width / size)); sign.position.set(x, y, z); sign.rotation.y = rotation;
    this.textures.add(sign.material.map!); this.owned.add(sign.material); return sign;
  }
  show(view: PitchView, slide: Map<string, number>) {
    this.clear();
    const p = view.pitch;
    this.group.add(this.label(`${p.department} pitch · ${p.status === 'ready' ? 'ready to pitch' : 'building'}`, 12.9, 2.35, R.minZ - 0.1, Math.PI, 3.4));
    if (p.status !== 'ready') return;
    for (const piece of p.pieces) {
      if (piece.kind === 'ads') {
        const count = Math.max(2, piece.images.length);
        for (let i = 0; i < count; i++) this.station(view, piece, i, T.x - 1.15 + i % 4 * 0.76, T.height + 0.035 + i * 0.001, T.z - 0.22 + Math.floor(i / 4) * 0.43, 0, 0.68, 0.38, true);
      } else if (piece.kind === 'site') this.station(view, piece, 0, R.maxX - 0.12, 1.85, 9.5, -Math.PI / 2, 2.25, 1.27);
      else if (piece.kind === 'video') this.station(view, piece, 0, 13.75, 1.88, R.minZ + 0.13, 0, 2.25, 1.27);
      else {
        this.station(view, piece, slide.get(piece.id) ?? 0, 10.15, 1.55, R.maxZ - 0.45, Math.PI, 1.35, 0.88);
        const stand = this.stations.at(-1)!.group;
        for (const x of [-0.46, 0.46]) {
          const leg = mesh(new THREE.BoxGeometry(0.08, 1.7, 0.09), toon(PALETTE.wood), x, -0.63, -0.05);
          leg.rotation.z = -x * 0.2; stand.add(leg);
        }
        stand.add(mesh(new THREE.BoxGeometry(1.5, 0.09, 0.18), toon(PALETTE.wood), 0, -0.48, 0.03));
      }
      const s = this.stations.find(s => s.piece.id === piece.id)!;
      const light = new THREE.PointLight('#ffd497', 0, 4.5, 2);
      light.position.set(piece.kind === 'ads' ? T.x : s.group.position.x, 2.5, piece.kind === 'ads' ? T.z : s.group.position.z + (piece.kind === 'slides' ? -0.5 : 0));
      light.castShadow = false; this.group.add(light); this.lights.push(light);
    }
  }
  private station(view: PitchView, piece: PitchPiece, index: number, x: number, y: number, z: number, rotation: number, width: number, height: number, flat = false) {
    const group = new THREE.Group(); group.name = `pitch-${piece.kind}${flat ? `-${index}` : ''}`;
    group.position.set(x, y, z); group.rotation.y = rotation;
    if (flat) { group.rotation.x = -Math.PI / 2; group.rotateZ(Math.PI); }
    this.group.add(group);
    const frame = mesh(new THREE.BoxGeometry(width + 0.09, height + 0.09, 0.055), toon(PALETTE.wood), 0, 0, -0.035, false);
    const material = new THREE.MeshBasicMaterial({ color: '#fff1de', toneMapped: false }); this.owned.add(material);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    face.name = `pitch-face-${piece.kind}`; group.add(frame, face);
    const it: Interactable = { kind: 'pitchpiece', x, z, y: 0, radius: flat ? 0.4 : 0.8, label: piece.id };
    group.userData.interact = face.userData.interact = frame.userData.interact = it;
    const station = { piece, group, face, material, width, height, it, index }; this.stations.push(station);
    group.add(this.label(flat ? `${piece.title} ${index + 1}` : piece.title, 0, -height / 2 - (flat ? 0.035 : 0.13), 0.015, 0, width * (flat ? 0.4 : 0.7)));
    if (piece.stamp) {
      const stamp = this.label(verdictLabel(piece.stamp.verdict), 0, height / 2 - 0.09, 0.025, 0, width * 0.9);
      stamp.name = 'pitch-stamp'; group.add(stamp);
    }
    const image = piece.images[index] ?? piece.image;
    if (image) {
      const generation = this.generation;
      new THREE.TextureLoader().load(pitchImageUrl(view.cubbyId, image.hash), texture => {
        if (generation !== this.generation) { texture.dispose(); return; }
        this.textures.add(texture); texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture; material.color.set('white'); material.needsUpdate = true;
      }, undefined, () => {});
    } else { const label = this.label(piece.kind === 'video' ? '▶ opens on your computer' : 'Preview coming soon', 0, 0, 0.02, 0, width * 0.95); label.name = 'pitch-placeholder'; group.add(label); }
  }
}
