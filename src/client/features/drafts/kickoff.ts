// Kick off (cubbies step 3), at the studio table on a draft of yours: K opens the confirm panel
// (ui-kickoff.ts), and once the office says the draft's kicked off (drafts.kicked for the floor you're
// on) the floor changes in front of you: the lights come up a desk row at a time, the covers fly off
// one row after another, the draft's panels fade, and the floor's itself again (the drafts feature puts
// everything back, see index.ts). The lead walks from the table through the doorway into the cubby
// hall and into cubby 0, where the cubby's own lead takes over. The office rings the gong on the floor
// for everyone there, so it isn't rung here as well; everyone else gets its "<name> is open." toast.

import { openStudio } from '../../shared/studio/actions';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { DOORWAY_WAIT_MS, KICKOFF_CODE, LEAD_SPEED, LEAD_START_MS, LEAVE_MS, along, coverLift, leadPath, lightLevel, panelsLeft, pathLength, type Point } from './kickoff-model';
import { PODS } from './model';
import { openKickoff, type KickoffPanel } from './ui-kickoff';
import type { DraftScene } from './world';

export interface KickoffDeps {
  scene: DraftScene;
  /** What you're aiming at (the studio table, for K). */
  aimed(): unknown;
  /** Whether the draft's up on the floor you're on (store.drafts.here, shown). */
  shown(): boolean;
  /** The draft that's up: its id, its name and the floor it's on. */
  draft(): { id: string; name: string; floor: string } | undefined;
  lead(): string;
  /** Takes the desks out from under their covers, for the covers to fly off them. */
  uncover(): void;
}

export interface Kickoff {
  /** Whether the draft `id` has been kicked off while you were here: it's no longer a draft for you. */
  kicked(id: string): boolean;
  /** The floor's changing: the draft's things are still up and being taken off. */
  changing(): boolean;
  /** The lead's on its way into the cubby hall (after the floor's itself again). */
  walking(): boolean;
  /** How much of the floor's light is on while it's changing. */
  light(): number;
  /** Moves it all along a frame. */
  tick(dt: number, t: number): void;
}

export function wireKickoff(ctx: Ctx, d: KickoffDeps): Kickoff {
  const { scene } = d;
  let panel: KickoffPanel | null = null;
  /** The run going on now: when it started, on which floor, and how far the lead's walked. */
  let run: { floor: string; at: number; last: number; path: Point[]; doorway: number; walked: number; waited: number } | null = null;
  const done = new Set<string>();
  const ms = () => (run ? performance.now() - run.at : Infinity);

  // K at the studio table, ahead of the office's own keys (the castle's herald has K from the throne).
  ctx.keys.add('activity', (e) => {
    if (e.code !== KICKOFF_CODE || e.repeat || !d.shown() || run || d.aimed() !== scene.table) return false;
    const draft = d.draft();
    if (!draft || !store.drafts.canKickoff) return false;
    if (store.drafts.here?.studio) { openStudio(ctx.net, 'open'); return true; }
    if (panel?.open) return true;
    panel = openKickoff(ctx.net, draft.floor, draft.name, d.lead());
    return true;
  });

  function start() {
    const draft = d.draft();
    if (run || !draft) return;
    done.add(draft.id);
    panel?.close();
    panel = null;
    const r = scene.lead.root.position;
    const { points, doorway } = leadPath({ x: r.x, z: r.z });
    run = { floor: draft.floor, at: performance.now(), last: 0, path: points, doorway, walked: 0, waited: 0 };
    scene.say('');
    scene.startKickoff();
    d.uncover();
    ctx.hint.invalidate();
  }

  ctx.messages.on('drafts.kicked', (m) => {
    if (m.floorId === store.floor && d.shown()) start();
  });
  // The office may tell you the floor's yours no longer (here gone, launched come) before it says kicked.
  store.on('drafts', () => {
    const draft = d.draft();
    if (!run && draft && d.shown() && !store.drafts.here && store.drafts.launched && store.floor === draft.floor) start();
  });
  ctx.messages.on('drafts.kickoffFailed', (m) => {
    if (m.floorId === store.floor && panel?.open) panel.failed(m.error);
  });

  /** `step` is how long since the last frame on the kickoff's own clock (the lights'), `dt` the frame's. */
  function walk(step: number, dt: number, t: number) {
    const w = run!;
    let moving = false;
    if (ms() >= LEAD_START_MS) {
      const stop = pathLength(w.path, w.doorway);
      const atDoor = w.walked >= stop - 0.01 && w.walked < stop + 0.5;
      // Waits at the doorway until the office has opened the hall (or long enough that it goes in anyway).
      if (atDoor && !ctx.office.cubbyHall.on && w.waited < DOORWAY_WAIT_MS) w.waited += step * 1000;
      else {
        const next = w.walked < stop ? Math.min(stop, w.walked + LEAD_SPEED * step) : w.walked + LEAD_SPEED * step;
        w.walked = next;
        moving = step > 0;
      }
    }
    const at = along(w.path, w.walked);
    const root = scene.lead.root;
    root.position.set(at.x, 0, at.z);
    if (moving) root.rotation.y = at.rotY;
    scene.leadIt.x = at.x;
    scene.leadIt.z = at.z;
    scene.lead.update(dt, t, moving && !at.done, false);
    if (at.done) finish();
  }

  function finish() {
    run = null;
    // The cubby's own lead is in there now: this one's done.
    scene.endKickoff();
    ctx.hint.invalidate();
  }

  return {
    kicked: (id) => done.has(id),
    changing: () => !!run && ms() < LEAVE_MS,
    walking: () => !!run,
    light: () => lightLevel(ms()),
    tick(dt, t) {
      if (!run) return;
      // Off the floor (the elevator, the garage, another map): it's over, as it would be by now anyway.
      if (store.floor !== run.floor || !ctx.inOffice() || ctx.upTop()) return finish();
      const now = ms();
      const step = Math.min(0.1, Math.max(0, now - run.last) / 1000);
      run.last = now;
      if (now < LEAVE_MS) {
        for (const p of PODS) scene.liftCover(p.id, coverLift(now, p));
        scene.fadeDraft(panelsLeft(now));
      }
      walk(step, dt, t);
    },
  };
}
