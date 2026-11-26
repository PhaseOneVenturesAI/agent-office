import * as THREE from 'three';
import { Worker } from '../../../world/character/worker';
import { mesh, toon } from '../../../world/toon';
import { helperName, type OwnerColor } from '../../../../shared/personal-agents/appearance';
import type { WorkerStatus, WorkerTask } from '../../../../shared/protocol';
import { PersonalNameplate } from './nameplate';
import { OwnerRing } from './ring';

/** Cream bodies and owner markings are instance-only; office Workers remain untouched. */
export class PersonalHelper extends Worker {
  private plate = new PersonalNameplate(1.55);
  readonly ring = new OwnerRing(this.root, 0.7);
  private title = '';
  private ownerColor = '#1e40c8';
  private accents: THREE.Mesh[] = [];
  private badge: THREE.Mesh;

  constructor(tool: string) {
    super(tool, '#f4ecdf');
    // The bean's parent is the animated body; accents follow its idle/working poses.
    const body = this.root.children.find(o => o.children.some(c => c instanceof THREE.Mesh && c.geometry.type === 'CapsuleGeometry'))!;
    body.children.find(c => c instanceof THREE.Mesh && c.geometry.type === 'CapsuleGeometry')!.name = 'personal-body';
    // The owner tip replaces the status bulb; status is on the plate.
    body.children.filter(c => c.position.y === 1.2).forEach(c => c.visible = false);
    const band = mesh(new THREE.CylinderGeometry(0.286, 0.286, 0.09, 24), toon(this.ownerColor), 0, 0.42, 0);
    const tip = mesh(new THREE.SphereGeometry(0.08, 12, 10), toon(this.ownerColor), 0, 1.2, 0);
    band.name = 'owner-band'; tip.name = 'owner-antenna-tip';
    this.badge = mesh(new THREE.BoxGeometry(0.12, 0.1, 0.025), toon(/kimi/i.test(tool) ? '#3f8f4f' : '#4a7dbd'), 0, 0.56, 0.28);
    this.badge.name = 'provider-badge';
    body.add(band, tip, this.badge); this.accents = [band, tip];
    this.root.add(this.plate.sprite);
  }

  // Avoid constructing inherited office name/task/status sprites at all.
  override setName(_name: string) {}
  override setTask(_task: WorkerTask | undefined) {}
  override setStatus(status: WorkerStatus, bounce: boolean) {
    this.status = status; this.bouncing = bounce;
    this.refreshPlate();
  }

  private refreshPlate() {
    const status = this.status === 'offline' ? '💤 asleep' : this.status === 'needs_input' ? 'Needs you' : this.status.replaceAll('_', ' ');
    this.plate.set(this.title, status, this.ownerColor);
  }

  dress(tool: string, task: string, color: OwnerColor) {
    this.title = helperName(tool, task); this.ownerColor = color;
    for (const part of this.accents) part.material = toon(color);
    this.badge.material = toon(/kimi/i.test(tool) ? '#3f8f4f' : '#4a7dbd');
    this.ring.setColor(color); this.refreshPlate();
    this.root.userData.personal = { ownerColor: color, label: this.title };
  }

  override update(dt: number, t: number) { super.update(dt, t); this.ring.update(); }
  override dispose() { this.plate.dispose(); this.ring.dispose(); super.dispose(); }
}
