import * as THREE from 'three';
import { Worker } from '../../../world/character/worker';
import { WorkerNameplate } from '../../../world/character/worker-nameplate';
import { disposeSprite, mesh, textSprite, toon } from '../../../world/toon';
import { helperName, type OwnerColor } from '../../../../shared/personal-agents/appearance';

/** An instance-only overlay: Worker, its dress/props and office nameplate are untouched. */
export class PersonalHelper extends Worker {
  private personalPill?: THREE.Sprite;
  private personalKey = '';
  private accents: THREE.Mesh[] = [];

  constructor(tool: string) {
    super(tool, /kimi/i.test(tool) ? '#3f8f4f' : '#4a7dbd');
    // The bean's parent is the animated body; accents follow its idle/working poses.
    const body = this.root.children.find(o => o.children.some(c => c instanceof THREE.Mesh && c.geometry.type === 'CapsuleGeometry'))!;
    const band = mesh(new THREE.CylinderGeometry(0.286, 0.286, 0.075, 24), toon('#6c4fd8'), 0, 0.49, 0);
    const tip = mesh(new THREE.SphereGeometry(0.08, 12, 10), toon('#6c4fd8'), 0, 1.2, 0);
    band.name = 'owner-band'; tip.name = 'owner-antenna-tip';
    body.add(band, tip); this.accents = [band, tip];
  }

  dress(tool: string, task: string, color: OwnerColor) {
    const label = helperName(tool, task), key = `${label}|${color}`;
    if (key === this.personalKey) return;
    this.personalKey = key;
    this.root.traverse(o => { if (o instanceof WorkerNameplate) o.visible = false; });
    for (const part of this.accents) part.material = toon(color);
    if (this.personalPill) { this.personalPill.removeFromParent(); disposeSprite(this.personalPill); }
    this.personalPill = textSprite(label, { bg: '#2b2d42', color: '#fffaf3', border: color, size: 32 });
    this.personalPill.position.y = 1.6; this.root.add(this.personalPill);
    this.root.userData.personal = { ownerColor: color, label };
  }
  override dispose() {
    if (this.personalPill) { this.personalPill.removeFromParent(); disposeSprite(this.personalPill); }
    super.dispose();
  }
}
