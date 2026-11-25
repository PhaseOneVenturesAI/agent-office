import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Building } from '../../src/server/building.js';
import { Drafts } from '../../src/server/drafts/index.js';
import { Nodes } from '../../src/server/nodes.js';
import { Cubbies } from '../../src/server/cubbies/index.js';
import { runKickoff } from '../../src/server/drafts/remote.js';
import { cleanDraftBoards } from '../../src/server/drafts/boards.js';
import { DRAFT_LIMITS } from '../../src/shared/protocol/drafts.js';
import { cleanImage, type DesignImage } from '../../src/server/drafts/image-format.js';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
export function pngChunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); return b;
}
export const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 2, 0, 3, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x22, 0xff, 0, 0x33, 0xff, 0xd9]);
export function webpChunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 8 + (data.length & 1)); b.write(type); b.writeUInt32LE(data.length, 4); data.copy(b, 8); return b;
}
export function webp(...chunks: Buffer[]) {
  const b = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), ...chunks]); b.writeUInt32LE(b.length - 8, 4); return b;
}
export function socket() {
  const events = new Map<string, Function[]>();
  return { readyState: 1, bufferedAmount: 0, sent: [] as any[],
    on(e: string, fn: Function) { events.set(e, [...events.get(e) ?? [], fn]); },
    send(raw: string) { this.sent.push(JSON.parse(raw)); },
    frame(frame: unknown) { for (const fn of events.get('message') ?? []) fn(Buffer.from(JSON.stringify(frame))); },
    close() { this.readyState = 3; for (const fn of events.get('close') ?? []) fn(); },
  };
}
export function imageFrames(floorId: string, image: DesignImage) {
  const b = image.bytes.toString('base64'), total = Math.ceil(b.length / DRAFT_LIMITS.chunk);
  return Array.from({ length: total }, (_, index) => ({ t: 'cubby.design-image', floorId, hash: image.meta.hash,
    mime: image.meta.mime, index, total, data: b.slice(index * DRAFT_LIMITS.chunk, (index + 1) * DRAFT_LIMITS.chunk) }));
}
export function boardFixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), 'draft-board-')), building = new Building(dir, dir);
  const drafts = new Drafts(dir, true, 'alice', id => id, building, { AGENT_OFFICE_KICKOFF_REMOTE: path.join(dir, 'remotes') },
    (cmd, args, cwd) => { if (cmd !== 'git') throw Error('No network'); return runKickoff(cmd, args, cwd); });
  const def = drafts.create('Board', 'alice');
  let cubbies!: Cubbies;
  const nodes = new Nodes(dir, () => cubbies?.refresh());
  cubbies = new Cubbies(dir, true, nodes, id => id, id => building.list().some(d => d.id === id), () => {}, Date.now,
    id => building.list().find(d => d.id === id)?.draft ? drafts.records.rows.get(id)?.owner : undefined);
  const setup = cubbies.setup(def.id, 'alice', 0, 'Nova', {} as any), ws = socket();
  nodes.attach(ws as any, setup.token); ws.frame({ t: 'hello', host: 'private', providers: [] });
  const hello = () => ws.frame({ t: 'cubby.hello', floorId: def.id, computerId: 'alice-computer', computerName: 'Computer' });
  const publish = (raw: unknown) => ws.frame({ t: 'cubby.snapshot', floorId: def.id, observedAt: Date.now(), agents: [], plan: [], needsYou: [], draft: raw });
  hello();
  const image = cleanImage(png), boards = cleanDraftBoards({ ideas: [{ id: 'idea', title: 'Idea', note: 'Explore it' }],
    screens: [{ id: 'welcome', title: 'Welcome', note: 'Keep it simple', status: 'approved', image: image.meta, feedback: [{ id: 'note', text: 'Looks good', at: 123 }] }] });
  publish(boards);
  const upload = () => imageFrames(def.id, image).forEach(frame => ws.frame(frame));
  t.after(() => { nodes.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, building, drafts, def, nodes, cubbies, ws, setup, hello, publish, image, boards, upload };
}
