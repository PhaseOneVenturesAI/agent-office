/**
 * Your status, over your character's head for everyone else: an emoji and a few words ("☕ BRB",
 * "📅 In a meeting") until you take it down. U (or ☰ → Set a status) opens the window to pick one;
 * the browser remembers it, so it's back up after a reload or a reconnect.
 */
import type * as THREE from 'three';
import { sameStatus, sanitizeStatus, statusLabel, type PeerStatus } from '../../../shared/peer-status';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import type { Person } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';
import { openStatus } from './ui';

const STORAGE_KEY = 'agent-office.status';
/** How far the chat bubble and an emote's emoji go up to make room for the badge. */
const BADGE_LIFT = 0.38;

function load(): PeerStatus | undefined {
  try {
    return sanitizeStatus(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return undefined;
  }
}

function save(s: PeerStatus | undefined) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked
  }
}

export function installStatus(ctx: Ctx, parts: Pick<Parts, 'peers' | 'hud'>) {
  let mine = load();
  /** The badge over each teammate's head, and what it says. */
  const badges = new Map<Person, { sprite: THREE.Sprite; label: string }>();

  function set(s: PeerStatus | undefined) {
    s = sanitizeStatus(s);
    if (sameStatus(s, mine)) return;
    mine = s;
    save(s);
    ctx.net.send({ t: 'status', status: s ?? null });
    parts.hud.hud.refresh();
  }

  function open() {
    openStatus(mine, set);
  }

  // Every welcome is a fresh start for the office (a reload, a reconnect, an upgrade): put it back up.
  ctx.messages.on('welcome', () => {
    if (mine) ctx.net.send({ t: 'status', status: mine });
  });

  ctx.keys.bind({ code: 'KeyU', preventDefault: true, run: open });

  function drop(person: Person) {
    const b = badges.get(person);
    if (!b) return;
    person.root.remove(b.sprite);
    disposeSprite(b.sprite);
    badges.delete(person);
  }

  // After the peers' own tick: the badge sits on top of the name tag (and the line under it), and the
  // chat bubble and an emote's emoji go up over the badge.
  ctx.ticks.add('hud', () => {
    const seen = new Set<Person>();
    for (const [id, r] of parts.peers.remotes) {
      const s = store.peers.get(id)?.status;
      if (!s) {
        drop(r.person);
        continue;
      }
      seen.add(r.person);
      const label = statusLabel(s);
      let b = badges.get(r.person);
      if (b?.label !== label) {
        drop(r.person);
        b = { sprite: textSprite(label, { bg: '#fff3bf', size: 32 }), label };
        r.person.root.add(b.sprite);
        badges.set(r.person, b);
      }
      b.sprite.position.y = r.person.bubbleY;
      if (r.bubble) r.bubble.sprite.position.y = r.person.bubbleY + BADGE_LIFT;
      r.person.emojiLift += BADGE_LIFT;
    }
    // Whoever left the floor (or took theirs down) since.
    for (const person of [...badges.keys()]) if (!seen.has(person)) drop(person);
  });

  return {
    /** Your status now, if you have one up. */
    mine: () => mine,
    open,
  };
}
