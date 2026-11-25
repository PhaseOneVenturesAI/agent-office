// Sharing a cubby (cubbies step 4). E at someone else's frosted door knocks; the owner, wherever they
// are on the floor, gets a prompt to let you watch and listen; let in, the door opens for you and you
// see the inside as they do, read-only, until you leave by its door (or they send you out). And in your
// own cubby, Q sends a task card out to the floor's public Task queue, where office-server agents take
// it. Only these words cross: a knock, an answer, a leave, and a card the owner wrote.

import type { CubbiesClientMsg, CubbyInfo } from '../../../shared/protocol/cubbies';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import type { CubbyRoom } from './room';
import { answerText, insideCubby, knockPending, outsideDoor, taskSentText } from './share-model';
import { openAdmitPrompt, openSendTask, type AdmitPrompt, type SendTaskPanel } from './ui-share';

export interface SharingDeps {
  rooms(): ReadonlyMap<number, CubbyRoom>;
  cubby(id: string): CubbyInfo | undefined;
  send(m: CubbiesClientMsg): void;
  /** Whether the cubbies are up on the floor you're on now. */
  shown(): boolean;
}

export interface Sharing {
  /** When you knocked on `id`, while it's still waiting for an answer. */
  knocked(id: string): boolean;
  knock(info: CubbyInfo): void;
  leave(info: CubbyInfo): void;
  /** Your own cubby, when you're standing inside it. */
  inOwn(): CubbyInfo | undefined;
  /** Puts you outside a cubby you've stopped watching, if you're still in it; call before the room shuts. */
  beforeSync(next: readonly CubbyInfo[]): void;
}

export function wireSharing(ctx: Ctx, d: SharingDeps): Sharing {
  const knocks = new Map<string, number>();
  const prompts = new Map<string, { prompt: AdmitPrompt; seen: boolean }>();
  let panel: SendTaskPanel | null = null;

  const here = () => ctx.player.pos;
  const roomAt = (slot: number) => d.rooms().get(slot);

  function inside(info: CubbyInfo | undefined): boolean {
    if (!info || !d.shown()) return false;
    const r = roomAt(info.slot);
    return !!r && insideCubby(r.place, here().x, here().z);
  }

  function inOwn(): CubbyInfo | undefined {
    const mine = store.cubbies.cubbies.find((c) => c.mine && c.interior && inside(c));
    return mine;
  }

  ctx.messages.on('cubbies.answer', (m) => {
    const c = d.cubby(m.id);
    if (!knocks.delete(m.id)) return;
    toast(answerText(c?.ownerName ?? 'They', m.allow));
    ctx.hint.invalidate();
  });

  ctx.messages.on('cubbies.knocked', (m) => {
    const c = d.cubby(m.id);
    if (!c?.mine || !m.by || typeof m.by.accountId !== 'string') return;
    const key = `${m.id}\n${m.by.accountId}`;
    if (prompts.get(key)?.prompt.open) return;
    const prompt = openAdmitPrompt(m.by.name, (allow) => {
      prompts.delete(key);
      d.send({ t: 'cubbies.admit', id: m.id, accountId: m.by.accountId, allow });
    });
    prompts.set(key, { prompt, seen: false });
  });

  // A knock answered somewhere else (another tab), or the knocker gave up: its prompt goes.
  store.on('cubbies', () => {
    for (const [key, p] of prompts) {
      const [id, accountId] = key.split('\n');
      const c = d.cubby(id);
      const there = c?.knocking?.some((k) => k.accountId === accountId);
      if (there) p.seen = true;
      else if (p.seen || !c?.mine) {
        prompts.delete(key);
        p.prompt.close();
      }
    }
  });

  ctx.messages.on('cubbies.taskSent', (m) => {
    toast(taskSentText(m.title));
    panel?.sent();
    panel = null;
  });

  // Q in your own cubby, ahead of the office's own keys (a carried card's Q puts it back, and still does
  // with your hands full; so does the ball's, which is the basketball's).
  ctx.keys.add('activity', (e) => {
    if (e.code !== 'KeyQ' || e.repeat || ctx.carrying() || store.ball.holder === store.you) return false;
    const c = inOwn();
    if (!c) return false;
    if (panel?.open) return true;
    panel = openSendTask((title, prompt) => d.send({ t: 'cubbies.sendTask', id: c.id, title, prompt }));
    return true;
  });

  return {
    knocked: (id) => knockPending(knocks.get(id), performance.now()),
    knock(info) {
      if (info.mine || info.watching || knockPending(knocks.get(info.id), performance.now())) return;
      knocks.set(info.id, performance.now());
      d.send({ t: 'cubbies.knock', id: info.id });
      ctx.hint.invalidate();
    },
    leave(info) {
      if (!info.watching) return;
      d.send({ t: 'cubbies.leave', id: info.id });
    },
    inOwn,
    beforeSync(next) {
      if (!d.shown()) return;
      for (const r of d.rooms().values()) {
        const was = r.info;
        if (!was?.watching) continue;
        const now = next.find((c) => c.id === was.id);
        if (now?.watching || !insideCubby(r.place, here().x, here().z)) continue;
        const out = outsideDoor(r.place);
        here().set(out.x, here().y, out.z);
      }
    },
  };
}
