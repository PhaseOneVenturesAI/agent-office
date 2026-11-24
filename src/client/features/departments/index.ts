/** Permanent characters stay on the original map, without becoming workers or reserving capacity. */
import * as THREE from 'three';
import type { RolePresence } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import { store } from '../../state';
import { openRoleCharacter } from '../../ui/role-character';
import { toast } from '../../ui/dom';
import { Worker } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import type { Interactable } from '../../world/types';
import type { World } from '../../world/world';

declare module '../../world/types' {
  interface InteractKinds {
    role: true;
  }
  interface Interactable { roleKey?: string }
}

export function installDepartments(ctx: Ctx) {
  const avatars = new Map<string, { model: Worker; badge: THREE.Sprite; it: Interactable; world: World; name: string }>();
  let roles: RolePresence[] = [], floor: string | null = null, requestId = '', queued = false, workerIds = '';
  let shownWorld: World | undefined;
  let shownError: string | undefined;
  const drop = (id: string) => {
    const view = avatars.get(id);
    if (!view) return;
    view.model.root.removeFromParent(); view.model.dispose(); disposeSprite(view.badge);
    const index = view.world.interactables.indexOf(view.it);
    if (index >= 0) view.world.interactables.splice(index, 1);
    avatars.delete(id);
  };
  const workerFor = (r: RolePresence) => {
    const id = r.department ? store.departments.departments.find(d => d.id === r.department)?.lead?.workerId : store.ceo.ceo?.workerId;
    return id ? store.workers.get(id) : undefined;
  };
  const position = new THREE.Vector3();
  const sync = () => {
    if (floor !== store.floor) { for (const id of avatars.keys()) drop(id); roles = []; floor = store.floor; }
    const world = ctx.world();
    shownWorld = world;
    const wanted = new Set<string>();
    for (const role of roles) {
      const desk = world.desks.get(role.deskId);
      if (!desk || workerFor(role)) continue;
      wanted.add(role.key);
      let view = avatars.get(role.key);
      if (view && (view.world !== world || view.name !== role.name)) { drop(role.key); view = undefined; }
      if (!view) {
        const dept = role.department ? store.departments.departments.find(d => d.id === role.department) : undefined;
        const color = !dept ? '#2b6f4e' : ({ marketing: '#e8853d', product: '#4a7dbd', review: '#8a6fbd' } as const)[dept.preset];
        const model = new Worker(role.name, color);
        model.setStatus('idle', false);
        const badge = textSprite('Off shift', { size: 28, bg: '#e9ecef', color: '#2b2d42' });
        badge.position.y = 1.95; model.root.add(badge);
        const it: Interactable = { kind: 'role', roleKey: role.key, x: 0, z: 0, radius: 1.3 };
        model.root.userData.interact = it; world.interactables.push(it);
        view = { model, badge, it, world, name: role.name }; avatars.set(role.key, view);
      }
      view.model.setRole(role.department ? { kind: 'manager', department: store.departments.departments.find(d => d.id === role.department)?.name ?? role.title.replace(/ manager$/i, '') } : { kind: 'ceo' });
      const sharedHome = roles.filter(r => r.deskId === role.deskId && !workerFor(r)).map(r => r.key).sort().indexOf(role.key);
      const occupied = !!store.workerAtDesk(role.deskId);
      if (occupied || sharedHome > 0) {
        // Even a small/custom floor or a retained duplicate home keeps distinct figures, never stacked in a chair.
        const beside = occupied ? sharedHome : sharedHome - 1;
        const [x, z] = [[1.35, 0.95], [-1.35, 0.95], [0.6, 2], [-0.6, 2]][beside % 4];
        desk.group.add(view.model.root); view.model.root.position.set(x, 0, z + Math.floor(beside / 4));
        view.model.root.rotation.y = Math.PI; view.model.root.scale.setScalar(0.82);
      } else {
        desk.seatAnchor.add(view.model.root); view.model.root.position.set(0, 0, 0);
        view.model.root.rotation.y = 0; view.model.root.scale.setScalar(1);
      }
      view.model.setCostume(store.theme.active);
      view.model.setOutfit(ctx.plan().agents.outfit === 'peasant' ? 'peasant' : null);
      view.model.root.getWorldPosition(position); view.it.x = position.x; view.it.z = position.z; view.it.y = 0;
    }
    for (const id of avatars.keys()) if (!wanted.has(id)) drop(id);
    ctx.hint.invalidate();
  };
  const request = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false; sync();
      if (!store.floor || !ctx.net.up) return;
      requestId = crypto.randomUUID(); ctx.net.send({ t: 'role.presence.get', requestId });
    });
  };
  ctx.messages.on('role.presence', msg => {
    if (msg.floor !== store.floor || msg.requestId !== requestId) return;
    if (msg.error && msg.error !== shownError) toast(msg.error, 'warn');
    shownError = msg.error;
    roles = msg.roles; floor = store.floor; sync();
  });
  for (const topic of ['floor', 'ceo', 'departments', 'floorPlan'] as const) store.on(topic, request);
  store.on('workers', () => {
    sync();
    const next = [...store.workers.keys()].sort().join('|');
    if (next !== workerIds) { workerIds = next; request(); }
  });
  store.on('theme', sync);
  ctx.interactions.define('role', {
    reach: 4.5,
    hint: it => {
      const role = roles.find(r => r.key === it.roleKey);
      return { k: `role:${role?.key}:${role?.name}`, parts: [hintTitle(role ? `${role.name} · ${role.title}` : 'Character'), aside('off shift · permanent'), key('E', 'Talk'), key('T', 'Talk')] };
    },
    use: (it, key) => { if ((key === 'E' || key === 'T') && it.roleKey) openRoleCharacter(ctx.net, it.roleKey); },
  });
  ctx.ticks.add('others', ({ dt, t }) => {
    if (shownWorld !== ctx.world()) sync();
    for (const view of avatars.values()) view.model.update(dt, t);
  });
  return { avatars };
}
