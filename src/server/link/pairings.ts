import { createHash, randomBytes } from 'node:crypto';
export const PAIRING_TTL = 10 * 60_000;
interface Pairing { id: string; secret: string; owner: string; computerId: string; computerName: string; expiresAt: number; token?: string; nodeId?: string; denied?: boolean }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** Only pending credentials live in memory. A restart invalidates uncollected approvals. */
export class Pairings {
  private rows = new Map<string, Pairing>();
  constructor(private owns: (owner: string) => boolean,
    private mint: (owner: string, computerId: string, name: string) => { token: string; id: string },
    private revoke: (id: string) => void, private changed: () => void, private now = Date.now) {}
  sweep() {
    for (const [id, p] of this.rows) if (p.expiresAt <= this.now()) {
      this.rows.delete(id); if (p.nodeId) this.revoke(p.nodeId);
    }
  }
  create(owner: string, computerId: string, computerName: string) {
    this.sweep();
    if (!this.owns(owner)) throw Error('Only the HQ owner can link a Mac');
    if (!/^[\w-]{1,128}$/.test(computerId) || !computerName.trim() || computerName.length > 60) throw Error('Invalid computer');
    if ([...this.rows.values()].some(p => p.owner === owner && !p.denied)) throw Error('A Mac is already waiting for approval; approve or deny it in HQ');
    for (const [id, p] of this.rows) if (p.owner === owner) this.rows.delete(id);
    const id = randomBytes(24).toString('hex'), secret = randomBytes(32).toString('hex');
    const p = { id, secret: hash(secret), owner, computerId, computerName: computerName.replace(/[\x00-\x1f\x7f]/g, ' '), expiresAt: this.now() + PAIRING_TTL };
    this.rows.set(id, p); this.changed();
    return { id, secret, expiresAt: p.expiresAt, approvalPath: `/?link=${id}` };
  }
  pending(owner: string) {
    this.sweep();
    if (!this.owns(owner)) throw Error('Only the HQ owner can see Mac pairings');
    return [...this.rows.values()].filter(p => p.owner === owner && !p.token && !p.denied)
      .map(({ id, computerName, expiresAt }) => ({ id, computerName, expiresAt }));
  }
  decide(owner: string, id: string, approve: boolean) {
    this.sweep(); const p = this.rows.get(id);
    if (!this.owns(owner) || !p || p.owner !== owner) throw Error('Pairing unavailable');
    if (p.token || p.denied) throw Error('Pairing already decided');
    if (approve) { const minted = this.mint(owner, p.computerId, p.computerName); p.token = minted.token; p.nodeId = minted.id; }
    else p.denied = true;
    this.changed();
  }
  forgetNode(nodeId: string) {
    for (const [id, p] of this.rows) if (p.nodeId === nodeId) this.rows.delete(id);
  }
  poll(id: string, secret: string) {
    this.sweep(); const p = this.rows.get(id);
    if (!p || typeof secret !== 'string' || p.secret !== hash(secret)) throw Error('Pairing expired or unavailable');
    if (p.denied) { this.rows.delete(id); return { state: 'denied' as const }; }
    if (!p.token) return { state: 'pending' as const };
    this.rows.delete(id); this.changed(); return { state: 'approved' as const, token: p.token };
  }
}
