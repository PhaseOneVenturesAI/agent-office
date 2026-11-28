import * as THREE from 'three';
import { MEETING_TABLE } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { closeAllModals } from '../../ui/dom';
import { openTalk } from '../../shared/hq/talk';
import { openPitchFlow, pitchProjects, pitchLeads } from '../../shared/pitch/flow';
import { pitchAlerts } from '../../shared/pitch/alerts';
import { sameDepartment } from '../../../shared/pitch/flow';
import { PitchFlowWorld } from './flow-world';
import { PitchPresenter } from './presenter';
declare module '../../world/types' {
  interface InteractKinds {
    pitchflow: true;
  }
}
export function wirePitchFlow(ctx: Ctx) {
  const world = new PitchFlowWorld(), presenter = new PitchPresenter(ctx), glow = new THREE.Group();
  glow.name = 'pitch-helper-desks'; ctx.scene.add(world.group, glow);
  const table = ctx.office.interactables.find(it => it.kind === 'meeting' && it.x === MEETING_TABLE.x && it.z === MEETING_TABLE.z);
  let previous = '', floor = store.floor, summoned: string | undefined;
  const active = () => ctx.inOffice() && !ctx.upTop() && pitchProjects().length > 0;
  ctx.usables.add({ usable: () => world.group.visible ? world.targets : [], pickable: () => world.group });
  ctx.interactions.define('pitchflow', { reach: 5,
    hint: () => ({ k: 'pitch-flow', parts: [hintTitle('Pitch room'), key('E', 'Departments / brief / directions / costs')] }),
    use: onE(it => { if (active()) openPitchFlow(ctx.net, store.pitch?.project, it.label); }),
  });
  ctx.messages.on('pitch.started', m => {
    closeAllModals(); summoned = m.leadId;
    const lead = pitchLeads().find(l => l.id === m.leadId); if (lead) presenter.enter(lead, true);
    const chat = openTalk(ctx.net, m.leadId); chat?.backdrop.classList.add('pitch-chat');
  });
  const alert = pitchAlerts(ctx.net, (id, index) => {
    const arrive = () => {
      ctx.net.send({ t: 'hq.pitch', projectIndex: index });
      ctx.player.pos.set(10.7, 0, 9); ctx.player.camYaw = -2; ctx.player.lookPitch = 0; ctx.player.updateCamera(true);
    };
    closeAllModals();
    if (store.floor === id) arrive(); else {
      const off = ctx.messages.on('floor.enter', () => { if (store.floor === id) { off(); arrive(); } });
      setTimeout(off, 15000); ctx.net.send({ t: 'floor.go', floor: id });
    }
  });
  ctx.messages.on('pitch.ready', alert);
  ctx.ticks.add('world', ({ dt, t }) => {
    if (floor !== store.floor) { floor = store.floor; summoned = undefined; presenter.clear(); }
    const view = store.pitch, leads = pitchLeads();
    const lead = (view?.project ? leads.find(l => l.project === view.project && sameDepartment(l.role, view.pitch.department)) : undefined) ?? leads.find(l => l.id === summoned);
    world.group.visible = active();
    if (table) table.kind = active() ? 'pitchflow' : 'meeting';
    const next = active() ? JSON.stringify([view, lead?.doing, lead?.helpers, pitchProjects()]) : '';
    if (next !== previous) { previous = next; if (next) world.show(view, lead); else world.clear(); }
    if (active() && lead) { presenter.enter(lead, false); presenter.update(dt, t, view?.pitch.status === 'ready'); } else presenter.clear();
    // Project-floor helper positions and identities come solely from the phase-3 representation.
    const helpers = active() && view?.pitch.picked && view.pitch.status === 'building' ? lead?.helpers ?? [] : [];
    while (glow.children.length > helpers.length) {
      const o = glow.children.at(-1) as THREE.Mesh; glow.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose();
    }
    helpers.forEach((helper, i) => {
      let lamp = glow.children[i] as THREE.Mesh;
      if (!lamp) { lamp = new THREE.Mesh(new THREE.CircleGeometry(.65, 32), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: .35, depthWrite: false })); lamp.rotation.x = -Math.PI / 2; lamp.add(new THREE.PointLight('#ffd166', .55, 2.2)); glow.add(lamp); }
      const body = ctx.scene.getObjectByName(`project-helper-${helper.id}`) ?? ctx.scene.getObjectByName(`hq-helper-${helper.id}`);
      lamp.visible = !!body; lamp.userData.helper = helper.id;
      if (body) { body.getWorldPosition(lamp.position); lamp.position.y += .035; }
    });
  });
}
