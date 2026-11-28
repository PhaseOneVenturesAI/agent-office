import * as THREE from 'three';
import type { OwnerColor } from '../../../shared/personal-agents/appearance';
import type { HQLead } from '../../../shared/protocol/hq';
import type { WorkHelper } from '../../../shared/protocol/live-work';
import { PersonalHelper } from '../cubbies/personal-agents/helper';
import { PersonalNameplate } from '../cubbies/personal-agents/nameplate';
import { disposeTree, factoryMachine, Face } from '../cubbies/props';
import { hqDeclutter } from './plates';
import { mesh, toon } from '../../world/toon';
import { taskBoard } from './task-board';

/** Activity-specific plates, without changing the legacy cubby helper's status semantics. */
class WorkBot extends PersonalHelper {
  private workPlate = new PersonalNameplate(1.55);
  constructor(helper: WorkHelper, color: OwnerColor) {
    super('claude');
    this.dress('claude', helper.title, color); this.setStatus(helper.doing === 'idle' ? 'idle' : 'working', false);
    this.root.getObjectByName('personal-nameplate')?.removeFromParent();
    this.workPlate.set(helper.title, helper.doing ?? '', color); this.root.add(this.workPlate.sprite);
  }
  override dispose() { this.workPlate.dispose(); super.dispose(); }
}
/** Same bodies/plates on HQ and the project floor. Each factory run gets its own machine. */
export class LiveWorkWorld {
  readonly roots: THREE.Object3D[] = [];
  readonly models: PersonalHelper[] = [];
  private machines: { group: THREE.Group; face: Face; plate: PersonalNameplate }[] = [];
  private boards: Face[] = [];
  private stands: THREE.Group[] = [];
  clear() {
    this.models.forEach(m => m.dispose()); this.models.length = 0;
    this.machines.forEach(m => { m.plate.dispose(); m.face.dispose(); disposeTree(m.group); m.group.removeFromParent(); }); this.machines = [];
    this.boards.forEach(b => { b.dispose(); b.mesh.removeFromParent(); }); this.boards = [];
    this.stands.forEach(s => { disposeTree(s); s.removeFromParent(); }); this.stands = [];
    this.roots.length = 0;
  }
  add(lead: HQLead, color: OwnerColor, group: THREE.Group, spot: { x: number; z: number; y?: number }, prefix = 'hq') {
    const department = lead.departmentIndex !== undefined;
    (lead.helpers ?? []).forEach((helper, i) => {
      let root: THREE.Group;
      if (helper.kind === 'factory') {
        const machine = factoryMachine(), plate = new PersonalNameplate(1.65);
        plate.set(helper.title, helper.doing ?? '', color); machine.group.add(plate.sprite);
        machine.face.draw(helper.doing ?? '', (c, w, h) => {
          c.fillStyle = '#292638'; c.fillRect(0, 0, w, h); c.fillStyle = color; c.fillRect(12, h / 2 - 8, w - 24, 16);
        });
        this.machines.push({ ...machine, plate }); root = machine.group;
      } else {
        const bot = new WorkBot(helper, color); this.models.push(bot); root = bot.root;
      }
      root.name = `${prefix}-helper-${helper.id}`; root.userData.helper = helper; root.userData.desk = lead.id;
      root.scale.setScalar(department ? .55 : .7);
      const row = Math.floor(i / 2), project = prefix === 'project';
      const dx = (i % 2 ? 1 : -1) * (project ? .65 : department ? .65 : 1.7);
      root.position.set(spot.x + dx, spot.y ?? 0, spot.z + (project ? 1 + row * .7 : -row * .65 + (department ? -.65 : .4)));
      const plate = root.getObjectByName('personal-nameplate') as THREE.Sprite; plate.material.depthTest = true;
      group.add(root); this.roots.push(root);
    });
  }
  board(leads: HQLead[], group: THREE.Group, spot: { x: number; z: number; y?: number }) {
    if (!leads.length) return;
    const workers = leads.flatMap(lead => [
      ...(lead.doing ? [{ id: lead.id, title: lead.title, doing: lead.doing }] : []), ...lead.helpers ?? [],
    ]).map(w => ({ ...w, provider: '', role: '', branch: '', startedAt: 0 }));
    const face = new Face(1.9, 1.6, 1024);
    face.draw(JSON.stringify(workers), (c, w, h) => { c.fillStyle = '#fff7e9'; c.fillRect(0, 0, w, h); taskBoard(c, w, { name: leads[0].project, hasMainLead: true, departmentLeads: [], workers }); });
    face.mesh.name = 'project-live-tasks'; face.mesh.userData.rows = workers;
    face.mesh.position.set(spot.x, (spot.y ?? 0) + 1.3, spot.z); group.add(face.mesh); this.boards.push(face);
    const stand = new THREE.Group(); stand.position.set(spot.x, spot.y ?? 0, spot.z - .04);
    stand.add(mesh(new THREE.BoxGeometry(1.98, 1.68, .06), toon('#765135'), 0, 1.3, 0));
    for (const dx of [-.5, .5]) stand.add(mesh(new THREE.BoxGeometry(.055, .5, .38), toon('#765135'), dx, .25, 0));
    group.add(stand); this.stands.push(stand);
  }
  update(dt: number, t: number) { this.models.forEach(m => m.update(dt, t)); }
  declutter(leads: THREE.Object3D[], camera: THREE.Camera) { hqDeclutter(leads, this.roots, this.boards.map(b => b.mesh), camera); }
}
