import type { CubbyInterior, CubbyPerson } from '../../shared/protocol/cubbies.js';

const COOLDOWN = 30_000;
const EXPIRY = 120_000;
interface Knock { clientId: string; at: number; timer: NodeJS.Timeout }
interface Room {
  knocks: Map<string, Knock>;
  watchers: Map<string, string>; // Browser connection -> account; reconnects must knock again.
  last: Map<string, number>; // Account cooldown survives leaving, rejection and disconnect.
}

/** Ephemeral permissions only. Never included in CubbyRecords or written to disk. */
export class CubbySharing {
  private rooms = new Map<string, Room>();
  constructor(private name: (id: string) => string | undefined, private online: (id: string) => boolean,
    private changed: () => void, private now: () => number) {}

  refresh() {
    for (const [id, room] of this.rooms) {
      const online = this.online(id);
      for (const [account, knock] of room.knocks) {
        if (!online || !this.name(account) || this.now() - knock.at >= EXPIRY) this.drop(room, account);
      }
      for (const [client, account] of room.watchers) if (!online || !this.name(account)) room.watchers.delete(client);
      for (const [account, at] of room.last) if (this.now() - at >= COOLDOWN) room.last.delete(account);
      if (!room.knocks.size && !room.watchers.size && !room.last.size) this.rooms.delete(id);
    }
  }

  knock(id: string, account: string, clientId: string): CubbyPerson {
    this.refresh();
    const room = this.rooms.get(id) ?? { knocks: new Map(), watchers: new Map(), last: new Map() };
    if (room.watchers.has(clientId)) throw Error('You are already watching this cubby');
    if (room.last.has(account)) throw Error('Wait 30 seconds before knocking on this cubby again');
    if (room.knocks.has(account)) throw Error('Your knock is still waiting for an answer');
    if (room.knocks.size >= 8) throw Error('This cubby already has 8 pending knocks');
    const knock: Knock = { clientId, at: this.now(), timer: setTimeout(() => {
      this.drop(room, account);
      this.refresh();
      this.changed();
    }, EXPIRY) };
    knock.timer.unref();
    room.knocks.set(account, knock); room.last.set(account, this.now()); this.rooms.set(id, room);
    return { accountId: account, name: this.name(account)! };
  }

  answer(id: string, account: string, allow: boolean): string[] {
    this.refresh();
    const room = this.rooms.get(id), knock = room?.knocks.get(account);
    const clients = [...room?.watchers ?? []].filter(([, owner]) => owner === account).map(([client]) => client);
    if (!room || (allow ? !knock : !knock && !clients.length)) throw Error('No pending knock or watcher for that account');
    if (knock) {
      clients.push(knock.clientId);
      this.drop(room, account);
      if (allow) room.watchers.set(knock.clientId, account);
    }
    if (!allow) for (const client of clients) room.watchers.delete(client);
    return [...new Set(clients)];
  }

  leave(clientId: string, id?: string) {
    for (const [key, room] of this.rooms) {
      if (id !== undefined && key !== id) continue;
      room.watchers.delete(clientId);
      for (const [account, knock] of room.knocks) if (knock.clientId === clientId) this.drop(room, account);
    }
    this.refresh();
  }

  watching(id: string, account?: string, clientId?: string): boolean {
    return !!account && !!clientId && this.rooms.get(id)?.watchers.get(clientId) === account;
  }
  people(id: string): { watchers: CubbyPerson[]; knocking: CubbyPerson[] } {
    const room = this.rooms.get(id);
    const person = (accountId: string): CubbyPerson => ({ accountId, name: this.name(accountId)! });
    return { watchers: [...new Set(room?.watchers.values())].map(person), knocking: [...room?.knocks.keys() ?? []].map(person) };
  }
  private drop(room: Room, account: string) {
    clearTimeout(room.knocks.get(account)?.timer);
    room.knocks.delete(account);
  }
}

/** Allow-list the watch/listen payload: pairing and owner-key details stay with the owner. */
export function watcherInterior(interior: CubbyInterior): CubbyInterior {
  const { computerName, leadName, look, agents, plan, needsYou, chat, observedAt, error } = interior;
  return { computerName, leadName, look, agents, plan, needsYou, chat, observedAt, error };
}
