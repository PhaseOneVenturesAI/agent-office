/**
 * Draft floors (cubbies step 2): a project before its kickoff, seen only by its owner. While you're on
 * one of your own drafts (store.drafts.here) the floor's lights are down, its desks are under sheets,
 * one lamp hangs over a studio table where the whiteboard stood, the north boards are Decisions, Plan
 * and Screens, the east wall has the Ideas board (over Services) and the Brand wall (over the TV), and your lead greets you at the doors and then waits by
 * the table. Everywhere else, and for everyone else, nothing here shows, collides or answers E: each
 * thing it hides or turns off is put back exactly as it was when you leave.
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key } from '../../core/hint';
import type { IdleAgent } from '../../core/stations';
import { store } from '../../state';
import { officeFill } from '../../world/sky';
import type { Collider, Interactable } from '../../world/types';
import type { Cubbies } from '../cubbies';
import { leadColorIndex, toolName } from '../cubbies/model';
import { wireDraftCards } from './board-cards';
import { wireDesignBook } from './design';
import { wireKickoff } from './kickoff';
import { KICKOFF_KEY, kickoffOffer } from './kickoff-model';
import { LoftLights } from './loft-lights';
import { DIM, LEAD_SPOTS, PODS, PODS_BY_STUDIO, STUDIO, greeting, leadName, studioAction, uncoveredPods, walkedPast } from './model';
import { DraftScene } from './world';

// The kinds of thing you can use that this adds (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    studiotable: true;
    draftlead: true;
  }
}

export interface DraftsDeps {
  /** Rides the elevator to a floor (your new draft, once it's made). */
  ride(floorId: string): void;
  /** The office's lights, which the sky sets afresh each frame: a draft turns them down after it. */
  lights(): { intensity: number }[];
  /** The board agents waiting by their boards, hidden on a draft until kickoff. */
  idleAgents(): IdleAgent[];
  /** The cubbies: the lead's chat, and the setup window. */
  cubbies(): Pick<Cubbies, 'setUp' | 'talk'>;
  /** What you're aiming at: the studio table for K, and whose name tag shows at an uncovered pod. */
  aimed(): unknown;
}

/** The office's things a draft turns off: the boards (Services too, under the Ideas board), the TV, the whiteboard, every desk in a pod and the board agents' kiosks. */
const PODDED = new Set(PODS.flatMap((p) => p.desks.map((d) => d.id)));
function draftTurnsOff(it: Interactable): boolean {
  if (it.kind === 'issues' || it.kind === 'queue' || it.kind === 'pulls' || it.kind === 'services' || it.kind === 'tv' || it.kind === 'whiteboard' || it.kind === 'station') return true;
  return it.kind === 'desk' && !!it.deskId && PODDED.has(it.deskId);
}

export function installDrafts(ctx: Ctx, deps: DraftsDeps) {
  const scene = new DraftScene();
  scene.group.visible = false;
  ctx.scene.add(scene.group);
  const { office } = ctx;

  /** What's turned off or put away while you're on the draft, to put back as it was. */
  let undo: (() => void)[] = [];
  let shown = false;
  let covered = '';
  /** The lead: at the doors, on its way to the table, or there. */
  let leadAt: 'greet' | 'walking' | 'table' = 'greet';
  let dim = 1;
  /** The draft that's up. */
  let shownFor = '';
  /** The "+" markers over the uncovered pods' seats, kept down while you're here (the workers' views put them up as workers come and go). */
  let quiet: { visible: boolean }[] = [];
  let kiosks: { visible: boolean }[] = [];

  /** The draft on the floor you're on, until it's kicked off (the office may still say it's one for a moment). */
  const here = () => {
    const h = store.drafts.here;
    return h && !kick.kicked(h.id) ? h : undefined;
  };
  /** The draft that's up, as it was when it went up (it's still that while it's kicked off). */
  let up: { id: string; name: string; floor: string } | undefined;
  const active = () => (!!here() || kick.changing()) && ctx.inOffice() && !ctx.upTop();
  const cubbyOf = () => {
    const id = here()?.cubbyId;
    return id ? store.cubbies.cubbies.find((c) => c.id === id && c.mine) : undefined;
  };
  const lead = () => leadName(here(), cubbyOf()?.interior?.leadName);

  function show(on: boolean) {
    shown = on;
    scene.group.visible = on;
    if (!on) {
      up = undefined;
      for (const fn of undo.reverse()) fn();
      undo = [];
      covered = '';
      quiet = [];
      kiosks = [];
      scene.clearDesigners();
      return;
    }
    const h = here()!;
    up = { id: h.id, name: h.name, floor: store.floor ?? h.id };
    leadAt = 'greet';
    placeLead(LEAD_SPOTS.greet);
    // Things to bump into: the whiteboard goes, the studio table comes.
    const cols: Collider[] = ctx.world().colliders;
    const wb = office.whiteboard;
    const gone = wb.colliders.filter((c) => cols.includes(c));
    for (const c of gone) cols.splice(cols.indexOf(c), 1);
    cols.push(...scene.colliders);
    undo.push(() => {
      for (const c of scene.colliders) if (cols.includes(c)) cols.splice(cols.indexOf(c), 1);
      cols.push(...gone);
    });
    wb.group.visible = false;
    undo.push(() => void (wb.group.visible = true));
    for (const it of office.interactables) {
      if (it.off || !draftTurnsOff(it)) continue;
      it.off = true;
      undo.push(() => void (it.off = false));
    }
    // The board agents wait at their kiosks with a card and an "Ask me" sign: all of it away until kickoff.
    for (const a of deps.idleAgents()) {
      if (a.model.root.visible) {
        a.model.root.visible = false;
        undo.push(() => void (a.model.root.visible = true));
      }
      for (const v of [a.view.vacancy, a.view.group]) {
        const was = v.visible;
        undo.push(() => void (v.visible = was));
        kiosks.push(v);
      }
    }
  }

  /** The covers, and the designers at the pods they've uncovered. */
  function syncPods() {
    const draft = here();
    if (!draft || !shown) return;
    const open = uncoveredPods(draft.designers);
    const k = [...open].join();
    if (k !== covered) {
      // Desks first back as they were, then the covered pods' put away again.
      covered = k;
      quiet = [];
      for (const p of PODS) {
        scene.covers.get(p.id)!.visible = !open.has(p.id);
        for (const d of p.desks) {
          const view = office.desks.get(d.id);
          if (!view) continue;
          // Uncovered for a designer, not for hiring: no "+" over its free seats.
          if (open.has(p.id)) quiet.push(view.vacancy);
          for (const [o, want] of [[view.group, open.has(p.id)], [view.vacancy, false]] as const) {
            if (o.visible === want) continue;
            const was = o.visible;
            o.visible = want;
            undo.push(() => void (o.visible = was));
          }
        }
      }
    }
    const helpers = (cubbyOf()?.interior?.agents ?? []).filter((a) => a.designer);
    scene.setDesigners(
      PODS_BY_STUDIO.filter((p) => open.has(p.id)),
      helpers.map((a) => ({ name: `${toolName(a.tool)} · screens`, task: a.task || 'Drawing screens' })),
      cubbyOf()?.ownerName ?? store.me.account?.name ?? '',
      (id) => office.desks.get(id),
    );
  }

  function sync() {
    const draft = here();
    if (!draft) return;
    // The cubby's lead is the one character: its look and its color (from its name) here as in there.
    const it = cubbyOf()?.interior;
    const name = lead();
    scene.setLead(name, it?.look, leadColorIndex(it?.leadName ?? name));
    scene.boards.sync(draft.boards, draft.id);
    syncPods();
    ctx.hint.invalidate();
  }

  function placeLead(at: { x: number; z: number; rotY: number }) {
    scene.lead.root.position.set(at.x, 0, at.z);
    scene.lead.root.rotation.y = at.rotY;
    scene.leadIt.x = at.x;
    scene.leadIt.z = at.z;
  }

  /** The lead greets you at the doors; once you've walked on past, it walks over to the table. */
  function moveLead(dt: number, t: number) {
    const draft = here();
    if (!draft) return;
    const p = ctx.player.pos;
    const r = scene.lead.root;
    let moving = false;
    if (leadAt === 'greet' && walkedPast(p.x, p.z)) leadAt = 'walking';
    if (leadAt === 'walking') {
      const to = LEAD_SPOTS.table;
      const dx = to.x - r.position.x;
      const dz = to.z - r.position.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 1.5 * dt);
      if (d < 0.05) {
        leadAt = 'table';
        r.rotation.y = to.rotY;
      } else {
        r.position.x += (dx / d) * step;
        r.position.z += (dz / d) * step;
        r.rotation.y = Math.atan2(dx, dz);
        moving = true;
      }
      scene.leadIt.x = r.position.x;
      scene.leadIt.z = r.position.z;
    }
    if (!moving) {
      // Turned toward you while you're near, so it talks to you rather than the wall.
      const dx = p.x - r.position.x;
      const dz = p.z - r.position.z;
      if (Math.hypot(dx, dz) < 6) {
        const want = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(want - r.rotation.y), Math.cos(want - r.rotation.y));
        r.rotation.y += diff * (1 - Math.exp(-dt * 4));
      }
    }
    scene.say(leadAt === 'greet' ? greeting(draft) : '');
    scene.lead.update(dt, t, moving, false);
  }

  store.on('drafts', sync);
  store.on('cubbies', sync);
  const kick = wireKickoff(ctx, {
    scene,
    aimed: deps.aimed,
    shown: () => shown,
    draft: () => up,
    lead,
    // Every pod's desks out from under their covers as they fly (they're all back for good once the floor's itself).
    uncover: () => {
      for (const p of PODS) for (const d of p.desks) {
        const view = office.desks.get(d.id);
        if (view) view.group.visible = true;
      }
    },
  });
  wireDesignBook(ctx);
  wireDraftCards(ctx, { boards: scene.boards, shown: () => shown, talk: (id) => deps.cubbies().talk(id) });
  const loft = new LoftLights(office.group, scene.group);
  ctx.usables.add({ usable: () => (shown ? [scene.table, scene.leadIt] : []), pickable: () => scene.group });
  ctx.ticks.add('others', (f) => {
    const on = active();
    const h = here();
    // Straight from one draft to another: everything put back, then the new one's put up.
    if (shown && on && h && h.id !== shownFor) show(false);
    if (on !== shown) {
      show(on);
      shownFor = on ? h!.id : '';
      if (on) sync();
    }
    kick.tick(f.dt, f.t);
    // The lead's walk into the cubby hall outlasts the draft: it alone stays up for it.
    const walk = !shown && kick.walking();
    scene.group.visible = shown || walk;
    scene.onlyLead(walk);
    if (!shown) return;
    for (const v of [...quiet, ...kiosks]) v.visible = false;
    if (!kick.walking()) moveLead(f.dt, f.t);
    const p = ctx.player.pos;
    scene.update(f.dt, f.t, { x: p.x, z: p.z, aimed: deps.aimed(), yaw: ctx.player.camYaw });
  });
  // After the sky (and the lamps indoors) have set the lights for this frame: turned down on a draft,
  // eased so stepping out of the elevator is a fade rather than a switch. Below in the garage, it's the garage's light.
  // The loft's lamps go down and up with it; while it's kicked off, the lights come up a row at a time.
  ctx.ticks.add('env', ({ dt }) => {
    const want = kick.changing() ? kick.light() : shown && ctx.player.pos.y > -1 ? DIM : 1;
    if (kick.changing()) dim = want;
    else dim += (want - dim) * (1 - Math.exp(-dt * 3));
    if (Math.abs(dim - want) < 0.002) dim = want;
    loft.set(dim);
    if (dim === 1) return;
    for (const l of deps.lights()) l.intensity *= dim;
    officeFill().multiplyScalar(dim);
  });

  ctx.messages.on('drafts.made', (m) => {
    if (store.floor !== m.floorId) deps.ride(m.floorId);
  });

  const act = () => studioAction(here() ?? {}, lead());
  const use = () => {
    const draft = here();
    if (!draft) return;
    if (draft.cubbyId) deps.cubbies().talk(draft.cubbyId);
    else deps.cubbies().setUp(0);
  };

  ctx.interactions.define('studiotable', {
    reach: 3,
    hint: () => {
      const a = act();
      // Kick off beside E, or why there's none (nothing while it's kicking off).
      const offer = kick.walking() ? null : kickoffOffer({ here: here(), canKickoff: store.drafts.canKickoff });
      const ko = !offer ? [] : offer.can ? [key(KICKOFF_KEY, offer.label)] : [aside(offer.why)];
      return { k: `studio-${a.label}-${offer ? (offer.can ? 'k' : 'no') : ''}`, parts: [hintTitle('🛋️ Studio table'), aside(here()?.name ?? up?.name ?? ''), key('E', a.label), ...ko] };
    },
    use: (_it, k) => {
      if (k === 'E') use();
    },
  });

  ctx.interactions.define('draftlead', {
    reach: 3.5,
    hint: () => {
      const a = act();
      const name = lead();
      return a.talk
        ? { k: `draftlead-${name}`, parts: [hintTitle(`💬 ${name}`), aside('your lead'), key('E', a.label)] }
        : { k: `draftlead-setup-${name}`, parts: [hintTitle(`💬 ${name}`), aside('set up at the studio table to talk')] };
    },
    use: (_it, k) => {
      if (k === 'E' && here()?.cubbyId) use();
    },
  });

  return { scene, studio: STUDIO, active: () => shown };
}
