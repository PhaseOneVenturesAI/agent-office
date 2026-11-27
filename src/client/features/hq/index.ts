import { selectMacPitch } from './mac-lead';
import { connectMac, wireMacConnection } from './connection';
import { toast } from '../../ui/dom';
import { wireHQLeads, type HQLeadDeps } from './leads';
import { hintTitle, key, onE } from '../../core/hint';
import { openHQBoard } from './ui';
import type * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { IdleAgent } from '../../core/stations';
import { store } from '../../state';
import type { Collider } from '../../world/types';
declare module '../../world/types' {
  interface InteractKinds {
    hqboard: true;
  }
}
/** An overlay with exact restoration, including the colliders of hidden desks. */
export function installHQ(ctx: Ctx, deps: { idleAgents(): IdleAgent[] } & HQLeadDeps) {
  wireHQLeads(ctx, deps);
  wireMacConnection(ctx);
  ctx.messages.on('hq.gong', msg => {
    if (store.hq?.floorId !== store.floor) return;
    ctx.world().gong?.strike(1); ctx.sound.gong('merged');
    toast(`${msg.project}: PR #${msg.pr} merged`);
  });
  const world = ctx.office.hq;
  let undo: (() => void)[] = [], content = '', shown = false;
  let quiet: THREE.Object3D[] = [];
  ctx.usables.add({ usable: () => shown ? world.interactables : [], pickable: () => world.group });
  ctx.interactions.define('hqboard', {
    reach: 5,
    hint: it => ({ k: 'hq-board', parts: [hintTitle(it.label ?? 'Portfolio'), key('E', it.label === 'Link your Mac' ? 'Link your Mac' : 'Read board')] }),
    use: onE(it => { if (shown && store.hq && it.label === 'Link your Mac') { connectMac(ctx); return; } if (shown && store.hq) openHQBoard(store.hq, it.label === 'Portfolio' ? undefined : it.label, (index, piece) => selectMacPitch(ctx, index, piece)); }),
  });
  const restore = () => { for (const fn of undo.reverse()) fn(); undo = []; quiet = []; shown = false; world.group.visible = false; };
  store.on('hq', () => { if (!store.hq || store.hq.floorId !== store.floor) { restore(); content = ''; } });
  const hide = (o: THREE.Object3D) => { const was = o.visible; o.visible = false; quiet.push(o); undo.push(() => { o.visible = was; }); };
  ctx.ticks.add('world', () => {
    const view = store.hq;
    const active = !!view && view.floorId === store.floor && ctx.inOffice() && !ctx.upTop();
    const next = active ? JSON.stringify(view) : '';
    if (next !== content) { restore(); content = next;
      if (active) {
        world.set(view!); world.group.visible = shown = true;
        const desks = [...ctx.office.desks.values()].filter(d => !d.def.room && !d.def.wing);
        desks.forEach(d => hide(d.group));
        world.coveredFurniture.forEach(hide);
        hide(ctx.office.signs.group);
        for (const agent of deps.idleAgents()) hide(agent.model.root);
        hide(ctx.office.whiteboard.group);
        // Put away board faces and frames; the portfolio covers the north-wall labels.
        for (const face of Object.values(ctx.office.boardMeshes)) if (face.parent && face.parent !== ctx.office.group) hide(face.parent);
        for (const it of ctx.office.interactables) {
          if (['desk', 'station', 'issues', 'pulls', 'queue', 'whiteboard'].includes(it.kind) && !it.off) {
            it.off = true; undo.push(() => { it.off = false; });
          }
        }
        const cols = ctx.world().colliders;
        const gone = cols.filter(c => ctx.office.whiteboard.colliders.includes(c) || world.coveredColliders.includes(c) || desks.some(d => Math.abs((c.minX + c.maxX) / 2 - d.def.x) < .1 && Math.abs((c.minZ + c.maxZ) / 2 - d.def.z) < .1 && c.top < 1.5));
        for (const c of gone) cols.splice(cols.indexOf(c), 1);
        const added: Collider[] = [...world.colliders]; cols.push(...added);
        undo.push(() => { for (const c of added) { const i = cols.indexOf(c); if (i >= 0) cols.splice(i, 1); } cols.push(...gone); });
      }
    }
    if (shown) for (const o of quiet) o.visible = false;
  });
}
