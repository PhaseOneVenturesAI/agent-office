import { hqPlates } from './plates';
import { HandShade } from './hand';
import { HQHelpers } from './helpers';
import { needsLabel, needsPlate } from '../../../shared/protocol/hq';
import { leadMessageBadge } from './messages';
import * as THREE from 'three';
import type { HQLead, HQView } from '../../../shared/protocol/hq';
import { personalRole } from '../../../shared/personal-agents/appearance';
import { PersonalPerson } from '../cubbies/personal-agents/person';
import { declutter } from '../cubbies/personal-agents/declutter';
import { disposeTree, Face, fitText } from '../cubbies/props';
import type { Interactable } from '../../world/types';
import { LeadFade } from './lead-fade';
import { AREAS } from './world';

export type LeadTarget = Interactable & { kind: 'hqlead' } & { lead: HQLead; card?: boolean };
export function deskSpot(lead: HQLead) {
  const [x, z] = AREAS[lead.projectIndex % AREAS.length];
  const i = lead.departmentIndex;
  return i === undefined ? { x, z: z - 2.55 } : { x: x - 2.65 + i % 4 * 1.75, z: z + .45 + Math.floor(i / 4) * 1.55 - .65 };
}
export function bodySpot(lead: HQLead) {
  const pitch = [[16.7, 9.3], [10.2, 9.3], [12.4, 8.9], [14.5, 8.9], [16.7, 11.7], [10.2, 11.7]][lead.projectIndex % 6];
  return lead.where === 'pitch' ? { x: pitch[0], z: pitch[1] } : deskSpot(lead);
}
export function statusText(lead: HQLead) {
  const c = lead.cubby, it = c?.interior;
  const state = c ? c.lamp === 'asleep' ? '💤 asleep' : it?.error ? '⚠️ error' : it?.agents.some(a => a.role === 'lead' && a.status === 'working') ? 'working' : 'idle' : undefined;
  return leadMessageBadge(lead) ?? (lead.needsYou ? [state, `✋ ${needsPlate(lead.needs)}`].filter(Boolean).join(' · ') : state ? `${state} · E to talk` : lead.role);
}
/** A real, readable card in the spot the lead left. E opens its conversation and Go there. */
export function statusCard(lead: HQLead, text: string, small = false) {
  const pending = leadMessageBadge(lead);
  const badge = pending ?? (lead.needsYou ? `Needs you${lead.needs ? ` · ${needsLabel(lead.needs)}` : ''}` : undefined);
  const face = new Face(small ? 1.5 : 1.8, small ? .36 : .75, 768);
  face.draw(JSON.stringify([lead.id, text, badge, lead.needsYou]), (c, w, h) => {
    c.fillStyle = '#fff7e9'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d9c6ab'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#292638'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${small ? 66 : 56}px sans-serif`; fitText(c, text, w / 2, h * .27, w - 32);
    c.font = `${small ? 48 : 40}px sans-serif`;
    fitText(c, `E to talk${pending && lead.needsYou ? ' · Needs you' : lead.floorId ? ' · Go there' : ''}`, w / 2, h * (badge ? .55 : .72), w - 32);
    if (badge) {
      c.fillStyle = '#ffd166'; c.beginPath(); c.roundRect(w * .04, h * .73, w * .92, h * .23, 12); c.fill();
      c.fillStyle = '#292638'; c.font = `bold ${small ? 36 : 38}px sans-serif`; fitText(c, badge, w / 2, h * .845, w - 32);
    }
  });
  face.mesh.name = 'hq-lead-status'; face.mesh.userData.statusText = text; face.mesh.userData.needsYou = lead.needsYou; face.mesh.userData.messageBadge = pending;
  return face;
}
export class HQLeadWorld {
  readonly group = new THREE.Group();
  readonly targets: LeadTarget[] = [];
  private shade = new HandShade();
  private helpers = new HQHelpers();
  private people: { model: PersonalPerson; lead: HQLead; fade?: LeadFade }[] = [];
  private faces: Face[] = [];
  constructor() { this.group.name = 'hq-leads'; }
  clear() {
    this.shade.clear();
    this.helpers.clear();
    this.people.forEach(p => { p.fade?.finish(); p.model.dispose(); }); this.people = [];
    this.faces.forEach(f => f.dispose()); this.faces = [];
    disposeTree(this.group); this.group.clear(); this.targets.length = 0;
  }
  set(view: HQView) {
    const previous = new Map(this.people.map(p => [p.lead.id, p.lead.where]));
    this.clear();
    // Six furnished project areas: the portfolio remains the list for any overflow projects.
    for (const lead of (view.leads ?? []).filter(l => l.projectIndex < AREAS.length)) {
      const desk = deskSpot(lead), spot = bodySpot(lead);
      if (lead.where !== 'hq') {
        const face = statusCard(lead, lead.where === 'pitch' ? 'In the pitch room' : `On the ${lead.project} floor`);
        face.mesh.position.set(desk.x, 1.35, desk.z + .85); this.faces.push(face); this.group.add(face.mesh);
        this.target(face.mesh, lead, desk.x, desk.z + .85, true);
      }
      if (lead.where !== 'project') {
        const model = new PersonalPerson(lead.title, view.ownerColor, lead.cubby?.interior?.look ?? { skin: 0, hair: 0, style: 0 });
        model.setUniform(view.ownerName, lead.project, personalRole({ department: lead.role }, lead.role === 'CEO'), view.ownerColor, lead.role);
        model.setDoing(statusText(lead)); model.root.position.set(spot.x, 0, spot.z); model.root.name = `hq-body-${lead.id}`;
        model.root.userData.leadId = lead.id;
        this.shade.set(model, !!lead.needs?.stale && lead.needsYou);
        (model.root.getObjectByName('personal-nameplate') as THREE.Sprite).material.depthTest = true;
        this.people.push({ model, lead, ...(previous.has(lead.id) && previous.get(lead.id) !== lead.where ? { fade: new LeadFade(model.root) } : {}) }); this.group.add(model.root); this.target(model.root, lead, spot.x, spot.z);
      }
      if (lead.needsYou) {
        const glow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: lead.needs?.stale ? .08 : .22, depthWrite: false }));
        glow.name = 'hq-needs-glow'; glow.rotation.x = -Math.PI / 2; glow.position.set(desk.x, .04, desk.z + .8); this.group.add(glow);
      }
    }
    this.helpers.set(view, this.group);
  }

  private target(object: THREE.Object3D, lead: HQLead, x: number, z: number, card = false) {
    const it: LeadTarget = { kind: 'hqlead', x, z, radius: 1.2, lead, card };
    object.userData.interact = it; this.targets.push(it);
  }
  update(dt: number, t: number, camera: THREE.Camera) {
    for (const { model, lead, fade } of this.people) {
      model.update(dt, t); fade?.update(dt);
      if (lead.needsYou) { model.rig.armL.rotation.z = -2.5; model.rig.armL.rotation.x = -.25; }
      model.root.userData.handRaised = lead.needsYou;
    }
    for (const model of this.helpers.models) {
      model.update(dt, t);
    }
    const roots = [...this.people.map(p => p.model.root), ...this.helpers.models.map(m => m.root)];
    declutter(hqPlates(roots, camera), roots, camera);
  }
}
