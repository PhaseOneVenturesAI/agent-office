// Inside your own cubby: your computer on its desk with its name tag and lamp, your lead with its name
// tag and status line, and every agent working in the project's folder on that computer, each where
// its role goes (see layoutAgents): builders at the builders' desk, a reviewer on the bean bag, factory
// runs at the machine with its deadline clock, Paradev workspaces on wall screens, sessions you opened
// directly standing about, and the rest on overflow bean bags. The wall boards are the lead's plan and
// what needs you. Asleep, the laptop's lid shuts, the lamp goes grey and every helper shows 💤.
//
// Only built for a cubby whose interior the server sent you: your own, or one you were let in to watch.

import * as THREE from 'three';
import type { CubbyAgent, CubbyInfo, CubbyInterior } from '../../../shared/protocol/cubbies';
import { AVATAR_COLORS } from '../../state/persist';
import { PersonalPerson } from './personal-agents/person';
import { PersonalHelper } from './personal-agents/helper';
import { defaultOwnerColor, helperTool, personalRole, type OwnerColor } from '../../../shared/personal-agents/appearance';
import { store } from '../../state';
import type { Collider } from '../../world/types';
import { Laptop } from '../workers/laptop';
import { focusedOf, showTags, type Focus } from './focus';
import { OVERFLOW_BAG_SCALE, agentCard, clip, colliderOf, deadlineText, furniture, toFloor, layoutAgents, layoutKey, usableAt, workerStatus, type CubbyIt, type CubbyPlacement, type Spot } from './model';
import { CREAM, FONT, Face, INK, beanbag, builderDesk, disposeTree, factoryMachine, fitText, simpleDesk, wallScreen } from './props';

interface AgentView {
  agent: CubbyAgent;
  /** A character, for everyone but a factory run at its machine and a workspace on its screen. */
  model: PersonalPerson | PersonalHelper | null;
  spot: Spot;
  key: string;
}

export class Interior {
  readonly group = new THREE.Group();
  colliders: Collider[] = [];
  usables: CubbyIt[] = [];
  private agentsGroup = new THREE.Group();
  private lead: PersonalPerson;
  private leadLook = '';
  private leadDoing = '';
  private laptop = new Laptop();
  private plan = new Face(1.6, 1.0, 512);
  private needs = new Face(1.4, 1.0, 448);
  private machine = factoryMachine();
  private screens = [wallScreen(), wallScreen()];
  private bagSeats: THREE.Object3D[] = [];
  private seats: THREE.Object3D[];
  private reviewerSeat: THREE.Object3D;
  private views = new Map<string, AgentView>();
  private layout = '';
  private asleep = false;
  private cubbyId = '';
  private interior: CubbyInterior | null = null;

  constructor(private place: CubbyPlacement) {
    const { width: w, depth: d } = place;
    const f = furniture(w, d);
    const box = (cx: number, cz: number, hw: number, hd: number, top: number) => this.colliders.push(colliderOf(place, cx, cz, hw, hd, top));

    // Your computer on its desk, its lamp beside it.
    const desk = simpleDesk(f.computerDesk.width, f.computerDesk.depth);
    desk.position.set(f.computer.x, 0, f.computer.z);
    this.group.add(desk);
    this.laptop.root.position.set(f.computer.x - 0.1, 0.78, f.computer.z + 0.02);
    this.laptop.root.scale.setScalar(1.1);
    this.laptop.setPlaceholder('▌ lead chat');
    this.group.add(this.laptop.root);
    box(f.computer.x, f.computer.z, f.computerDesk.width / 2 + 0.02, f.computerDesk.depth / 2 + 0.03, 0.8);

    // The lead, standing in front of it, facing the door.
    this.lead = new PersonalPerson('Lead', AVATAR_COLORS[0], { skin: 0, hair: 0, style: 0 });
    this.lead.root.position.set(f.lead.x, 0, f.lead.z);
    this.lead.ring.floorY = place.y ?? 0;
    // The lead stands beside the left partition; keep the whole plate inside the room.
    this.lead.root.getObjectByName('personal-nameplate')!.position.x = 0.45;
    this.group.add(this.lead.root);

    // The builders' desk: two seats, the harness's limit.
    const bd = builderDesk();
    bd.group.position.set(f.builderDesk.x, 0, f.builderDesk.z);
    this.group.add(bd.group);
    this.seats = bd.seats;
    box(f.builderDesk.x, f.builderDesk.z, 0.92, 0.42, 0.8);

    // The reviewer's bean bag.
    const rb = beanbag(0);
    rb.group.position.set(f.reviewer.x, 0, f.reviewer.z);
    rb.group.rotation.y = f.reviewer.rotY;
    this.group.add(rb.group);
    this.reviewerSeat = rb.seat;

    // The factory machine and the Paradev screens, hidden until there's a run or a workspace.
    this.machine.group.position.set(f.machine.x, 0, f.machine.z);
    this.machine.group.rotation.y = f.machine.rotY;
    this.group.add(this.machine.group);
    for (const [i, s] of this.screens.entries()) {
      const spot = f.screens[i];
      s.group.position.set(spot.x, 2.1, spot.z);
      s.group.rotation.y = spot.rotY;
      this.group.add(s.group);
    }

    // Overflow bean bags, brought out as they're needed.
    for (const spot of f.bags) {
      const b = beanbag(spot.index + 1);
      b.group.position.set(spot.x, 0, spot.z);
      // Small bags, the cubby being small; whoever sits in one stays their usual size.
      b.group.scale.setScalar(OVERFLOW_BAG_SCALE);
      b.seat.scale.setScalar(b.seat.scale.x / OVERFLOW_BAG_SCALE);
      b.group.visible = false;
      this.group.add(b.group);
      this.bagSeats.push(b.seat);
    }

    // The wall boards: the lead's plan and what needs you.
    for (const [face, at] of [[this.plan, f.plan], [this.needs, f.needs]] as const) {
      face.mesh.scale.setScalar(at.width / (face === this.plan ? 1.6 : 1.4));
      face.mesh.position.set(at.x, at.y, at.z + 0.03);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: INK }));
      back.scale.set(face.mesh.scale.x * (face === this.plan ? 1.6 : 1.4) + 0.1, face.mesh.scale.y + 0.1, 1);
      back.position.set(at.x, at.y, at.z + 0.02);
      this.group.add(back, face.mesh);
    }
    this.group.add(this.agentsGroup);
  }

  sync(cubbyId: string, it: CubbyInterior, lampState: CubbyInfo['lamp'], ownerName: string, watching = false, color: OwnerColor = defaultOwnerColor(ownerName)) {
    this.cubbyId = cubbyId;
    this.interior = it;
    this.asleep = lampState === 'asleep';
    const lookKey = JSON.stringify([it.leadName, it.look]);
    if (lookKey !== this.leadLook) {
      this.leadLook = lookKey;
      this.lead.setLook(it.look);
    }
    const project = store.project?.name ?? 'Project';
    this.lead.setUniform(ownerName, project, personalRole(it.agents.find(a => a.role === 'lead'), true), color);
    const doing = this.asleep ? `💤 asleep on ${clip(it.computerName, 20)}` : it.error ? `⚠️ ${clip(it.error, 40)}` : watching ? 'E to listen in' : `E to talk · ${clip(it.computerName, 20)}`;
    if (doing !== this.leadDoing) this.lead.setDoing((this.leadDoing = doing));
    this.syncAgents(it.agents, ownerName, project, color);
    this.paintBoards(it);
    this.usables = this.makeUsables();
  }

  private syncAgents(agents: readonly CubbyAgent[], ownerName: string, project: string, color: OwnerColor) {
    const key = layoutKey(agents) + JSON.stringify(agents.map(a => [a.id, a.tool, personalRole(a)]));
    if (key !== this.layout) {
      this.layout = key;
      const { spots } = layoutAgents(agents, this.place.width, this.place.depth);
      for (const [id, v] of this.views) {
        const spot = spots.get(id);
        const next = agents.find(a => a.id === id);
        const still = spot && next && v.spot.kind === spot.kind && v.spot.index === spot.index && v.agent.role === next.role && v.agent.tool === next.tool;
        if (!still) this.dropView(id);
      }
      for (const a of agents) {
        const spot = spots.get(a.id);
        if (!spot || this.views.has(a.id)) continue;
        this.views.set(a.id, { agent: a, spot, model: this.placeModel(a, spot), key: '' });
      }
      for (const [i, seat] of this.bagSeats.entries()) seat.parent!.visible = [...this.views.values()].some((v) => v.spot.kind === 'bag' && v.spot.index === i);
      this.machine.group.visible = [...this.views.values()].some((v) => v.spot.kind === 'machine');
      for (const [i, s] of this.screens.entries()) s.group.visible = [...this.views.values()].some((v) => v.spot.kind === 'screen' && v.spot.index === i);
    }
    for (const a of agents) {
      const v = this.views.get(a.id);
      if (!v) continue;
      v.agent = a;
      const card = agentCard(a);
      const k = `${card.name}|${card.title}|${card.body}|${a.status}|${this.asleep}|${ownerName}|${project}|${color}|${personalRole(a)}`;
      if (k === v.key) continue;
      v.key = k;
      if (v.model) {
        if (v.model instanceof PersonalHelper) {
          v.model.setStatus(workerStatus(a.status, this.asleep), false);
          v.model.setTask({ name: card.title, summary: card.body });
          v.model.dress(a.tool, a.role === 'direct' ? `${a.tool} session` : a.task, color);
        } else {
          v.model.setStatus(workerStatus(a.status, this.asleep));
          v.model.setUniform(ownerName, project, personalRole(a), color);
          v.model.setDoing(this.asleep ? '💤 asleep' : a.status === 'needs-you' ? 'Needs you' : a.status);
        }
      }
      if (v.spot.kind === 'screen') this.paintScreen(v.spot.index, a);
    }
  }

  /** A worker for `a` in its seat or spot, or none where its machine or screen stands for it. */
  private placeModel(a: CubbyAgent, spot: Spot): PersonalPerson | PersonalHelper | null {
    if (spot.kind === 'machine' || spot.kind === 'screen') return null;
    const w = helperTool(a.tool) ? new PersonalHelper(a.tool) : new PersonalPerson(a.tool, '#6c4fd8', this.interior!.look);
    w.ring.floorY = this.place.y ?? 0;
    const seat = spot.kind === 'seat' ? this.seats[spot.index] : spot.kind === 'reviewer' ? this.reviewerSeat : spot.kind === 'bag' ? this.bagSeats[spot.index] : null;
    if (seat) {
      seat.add(w.root);
      if (w instanceof PersonalPerson) w.sit(0);
    }
    else {
      w.root.position.set(spot.x, 0, spot.z);
      w.root.rotation.y = spot.rotY;
      this.agentsGroup.add(w.root);
    }
    w.root.userData.interact = null;
    return w;
  }

  private dropView(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    if (!v.model) return;
    v.model.root.removeFromParent();
    v.model.dispose();
    disposeTree(v.model.root);
  }

  private makeUsables(): CubbyIt[] {
    const p = this.place;
    const f = furniture(p.width, p.depth);
    const extra = { cubbyId: this.cubbyId };
    const out: CubbyIt[] = [usableAt(p, 'cubbylead', f.lead.x, f.lead.z, 1.4, extra), usableAt(p, 'cubbycomputer', f.computer.x, f.computer.z + 0.5, 1.1, extra)];
    this.lead.root.userData.interact = out[0];
    this.laptop.root.userData.interact = out[1];
    for (const [id, v] of this.views) {
      const it = usableAt(p, 'cubbyagent', v.spot.x, v.spot.z, v.spot.kind === 'screen' ? 1.4 : 1.0, { ...extra, agentId: id });
      out.push(it);
      if (v.model) v.model.root.userData.interact = it;
      else if (v.spot.kind === 'machine') this.machine.group.userData.interact = it;
      else if (v.spot.kind === 'screen') this.screens[v.spot.index].group.userData.interact = it;
    }
    return out;
  }

  private paintBoards(it: CubbyInterior) {
    const lead = clip(it.leadName, 18);
    this.plan.draw(`${lead}|${it.plan.join('\n')}`, (c, w, h) => {
      c.fillStyle = CREAM;
      c.fillRect(0, 0, w, h);
      c.fillStyle = INK;
      c.font = FONT(34);
      c.textBaseline = 'top';
      fitText(c, `${lead.toUpperCase()}’S PLAN`, 24, 20, w - 48);
      c.font = FONT(28, 700);
      const lines = it.plan.slice(0, 6);
      if (!lines.length) c.fillText('No plan yet', 24, 80);
      for (const [i, line] of lines.entries()) fitText(c, `${i + 1}  ${line}`, 24, 76 + i * 44, w - 48);
    });
    this.needs.draw(it.needsYou.join('\n'), (c, w, h) => {
      c.fillStyle = CREAM;
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e76f51';
      c.font = FONT(32);
      c.textBaseline = 'top';
      c.fillText('NEEDS YOU', 24, 20);
      const items = it.needsYou.slice(0, 4);
      c.font = FONT(24, 700);
      if (!items.length) {
        c.fillStyle = INK;
        c.fillText('Nothing right now', 24, 80);
      }
      for (const [i, item] of items.entries()) {
        const y = 70 + i * 54;
        c.fillStyle = '#ffc2d1';
        c.beginPath();
        c.roundRect(20, y, w - 40, 44, 10);
        c.fill();
        c.strokeStyle = INK;
        c.lineWidth = 3;
        c.stroke();
        c.fillStyle = INK;
        fitText(c, item, 34, y + 10, w - 68);
      }
    });
  }

  private paintScreen(i: number, a: CubbyAgent) {
    const card = agentCard(a);
    this.screens[i].face.draw(`${card.name}|${card.title}|${card.body}|${a.status}|${this.asleep}`, (c, w, h) => {
      c.fillStyle = this.asleep ? '#4a4e69' : INK;
      c.fillRect(0, 0, w, h);
      c.textBaseline = 'top';
      c.fillStyle = '#8ecae6';
      c.font = FONT(22);
      fitText(c, `paradev · ${a.branch || a.tool}`, 16, 14, w - 32);
      c.fillStyle = '#caffbf';
      c.font = FONT(20, 700);
      fitText(c, `$ ${card.title}`, 16, 58, w - 32);
      c.fillStyle = CREAM;
      fitText(c, this.asleep ? '💤 asleep' : card.body || a.status, 16, 92, w - 32);
    });
  }

  /**
   * The one helper whose name tag and card show: the one you're aiming at, else the nearest one you're
   * standing right by that's in front of you. Never more than one, so their labels can't pile up in a small room.
   */
  private focused(focus?: Focus) {
    const all = [...this.views.values()].filter((v) => v.model);
    return focusedOf(all.map((v) => ({ item: v, ...toFloor(this.place, v.spot.x, v.spot.z), interact: v.model!.root.userData.interact })), focus);
  }

  update(dt: number, t: number, now: number, focus?: Focus) {
    if (this.asleep) this.laptop.shut(dt);
    else this.laptop.update(dt, undefined, 0);
    this.lead.update(dt, t, false, false);
    const shown = this.focused(focus);
    // Give the focused helper the reading space; the lead plate returns when focus leaves it.
    showTags(this.lead.root, !shown);
    for (const v of this.views.values()) {
      v.model?.update(dt, t);
      if (v.model) {
        showTags(v.model.root, v === shown);
      }
      if (v.spot.kind === 'machine') {
        const a = v.agent;
        const left = this.asleep ? '💤 paused' : deadlineText(a.deadlineAt, now);
        this.machine.face.draw(`${left}|${a.progress ?? ''}`, (c, w, h) => {
          c.fillStyle = CREAM;
          c.fillRect(0, 0, w, h);
          c.fillStyle = INK;
          c.font = FONT(26);
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          fitText(c, `🏭 ${left}`, w / 2, h * 0.32, w - 16);
          c.font = FONT(18, 700);
          fitText(c, clip(a.progress ?? a.task, 28), w / 2, h * 0.7, w - 16);
        });
      }
    }
  }

  /** Every agent's id, in roster order. */
  get roster(): readonly CubbyAgent[] {
    return this.interior?.agents ?? [];
  }

  dispose() {
    for (const id of [...this.views.keys()]) this.dropView(id);
    this.laptop.dispose();
    this.lead.dispose();
    disposeTree(this.lead.root);
    this.lead.root.removeFromParent();
    this.plan.dispose();
    this.needs.dispose();
    this.machine.face.dispose();
    for (const s of this.screens) s.face.dispose();
    disposeTree(this.group);
    this.group.clear();
  }
}

export type { Focus } from './focus';
