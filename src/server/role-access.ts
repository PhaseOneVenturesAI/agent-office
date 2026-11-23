// Role access (see docs/department-leads.md): who may talk to or edit the CEO and the department
// managers. The CEO is privately owned (one owner email per project) — only that owner talks to it
// or edits it; ownership changes are admin control, never arbitrary coworkers. A department
// manager is controlled by its designated controllers (plus the project owner); everyone else in
// its Q&A audience gets read-only questions that can never assign, delegate, write files, or change
// decisions, and are recorded under their own scope. An office without accounts keeps the old
// single-user behavior: whoever is there is the owner.

import type { Ctx } from './office/context.js';
import type { Floor } from './floor.js';

export type RoleAccess = { kind: 'owner' } | { kind: 'controller' } | { kind: 'staff' } | { kind: 'none'; why: string };

export function accountEmail(ctx: Ctx, accountId: string | undefined): string | undefined {
  const email = accountId ? ctx.accounts.get(accountId)?.email : undefined;
  return email ? email.toLowerCase() : undefined;
}

export const isAdmin = (ctx: Ctx, accountId: string | undefined): boolean => !!accountId && !!ctx.meOf(accountId)?.admin;

/**
 * The configured owner for every project CEO (operator-level, e.g. AGENT_OFFICE_CEO_OWNER). An
 * in-app owner field may narrow or replace it, but office-admin status alone never grants the CEO:
 * role administration is delegated by the current project/role owner, not seized.
 */
export const configuredCeoOwner = (): string | undefined => {
  const v = process.env.AGENT_OFFICE_CEO_OWNER?.trim().toLowerCase();
  return v || undefined;
};

/** The effective CEO owner: the identity's own field, else the operator configuration. */
export function ceoOwner(floor: Floor): string | undefined {
  return floor.ceo.get()?.owner?.toLowerCase() ?? configuredCeoOwner();
}

/** Who this account is for this role worker: owner, controller, staff (read-only Q&A), or nobody. */
export function roleAccess(ctx: Ctx, floor: Floor, workerId: string, accountId: string | undefined): RoleAccess {
  if (!ctx.accounts.any) return { kind: 'owner' };
  const email = accountEmail(ctx, accountId);
  if (!email) return { kind: 'none', why: 'Sign in with your own account first.' };
  const owner = ceoOwner(floor);
  if (floor.ceo.get()?.workerId === workerId) {
    return email === owner ? { kind: 'owner' } : { kind: 'none', why: `The CEO is private to ${owner ?? 'its owner'}.` };
  }
  const dept = floor.departments.leadDeptOfWorker(workerId);
  if (dept?.lead) {
    if (dept.lead.controllers?.map((e) => e.toLowerCase()).includes(email) || (owner && email === owner)) return { kind: 'controller' };
    const audience = dept.lead.audience ?? [];
    if (!audience.length || audience.map((e) => e.toLowerCase()).includes(email)) return { kind: 'staff' };
    return { kind: 'none', why: `Read-only questions for the ${dept.name} manager are limited to its Q&A audience.` };
  }
  return { kind: 'none', why: '' };
}

/** Access to a department itself (its read-only Ask box): any staff in the audience, or its controllers. */
export function roleAccessForManager(ctx: Ctx, floor: Floor, deptId: string, accountId: string | undefined): RoleAccess {
  if (!ctx.accounts.any) return { kind: 'owner' };
  const email = accountEmail(ctx, accountId);
  if (!email) return { kind: 'none', why: 'Sign in with your own account first.' };
  const dept = floor.departments.get(deptId);
  if (!dept?.lead) return { kind: 'none', why: 'Name the manager first.' };
  const owner = ceoOwner(floor);
  if (dept.lead.controllers?.map((e) => e.toLowerCase()).includes(email) || (owner && email === owner)) return { kind: 'controller' };
  const audience = dept.lead.audience ?? [];
  if (!audience.length || audience.map((e) => e.toLowerCase()).includes(email)) return { kind: 'staff' };
  return { kind: 'none', why: `Read-only questions for the ${dept.name} manager are limited to its Q&A audience.` };
}

/**
 * May this account edit the CEO identity/engine (name, model, launch, assign from the panel)?
 * Only the current owner — office admins are NOT a bypass. Before any owner exists (no identity
 * field and no operator configuration), setting the CEO up is an office-admin task; the moment an
 * owner exists, only that owner edits or starts it, and only that owner may pass ownership on.
 */
export function canEditCeo(ctx: Ctx, floor: Floor, accountId: string | undefined): { ok: boolean; why?: string } {
  if (!ctx.accounts.any) return { ok: true };
  const email = accountEmail(ctx, accountId);
  const owner = ceoOwner(floor);
  if (owner) return email === owner ? { ok: true } : { ok: false, why: `Only ${owner} may edit or start the CEO — office admins included.` };
  return isAdmin(ctx, accountId) ? { ok: true } : { ok: false, why: 'An office admin sets the CEO up first; then only its owner may edit or start it.' };
}

/**
 * May this account change who controls a manager, its Q&A audience, or its billing custodian?
 * Delegated: the current controllers or the CEO owner. Office admins may bootstrap the lists when
 * nobody is designated yet — they can never seize or rewrite an existing delegation.
 */
export function canDelegateManager(ctx: Ctx, floor: Floor, deptId: string, accountId: string | undefined): { ok: boolean; why?: string } {
  if (!ctx.accounts.any) return { ok: true };
  const email = accountEmail(ctx, accountId);
  const dept = floor.departments.get(deptId);
  if (!dept) return { ok: false, why: 'That department is gone' };
  const owner = ceoOwner(floor);
  const controllers = dept.lead?.controllers ?? [];
  if (controllers.length || owner) {
    if ((owner && email === owner) || controllers.map((e) => e.toLowerCase()).includes(email ?? '')) return { ok: true };
    return { ok: false, why: `Only the ${dept.name} controllers (${controllers.join(', ') || 'none'}) or the CEO owner (${owner}) may change this delegation — office admins included.` };
  }
  return isAdmin(ctx, accountId) ? { ok: true } : { ok: false, why: 'An office admin designates the first controllers; they delegate onwards.' };
}

/** May this account edit this manager (model, settings, brief, objectives, delegation)? */
export function canEditManager(ctx: Ctx, floor: Floor, deptId: string, accountId: string | undefined): { ok: boolean; why?: string } {
  if (!ctx.accounts.any) return { ok: true };
  const email = accountEmail(ctx, accountId);
  const dept = floor.departments.get(deptId);
  if (!dept?.lead) return { ok: false, why: 'Name the manager first.' };
  const owner = floor.ceo.get()?.owner?.toLowerCase();
  if ((owner && email === owner) || dept.lead.controllers?.map((e) => e.toLowerCase()).includes(email ?? '')) return { ok: true };
  return { ok: false, why: `Only the ${dept.name} controllers (${dept.lead.controllers?.join(', ') || 'none named yet'}) or the CEO owner (${ceoOwner(floor) ?? 'none'}) may edit this manager.` };
}

/** Staff Q&A preamble: keeps the character honest about what a read-only question may trigger. */
export function qaPreamble(byName: string): string {
  return `[Read-only Q&A from ${byName}. Answer the question briefly. This conversation cannot assign work, delegate, write project files, change decisions, or spend anything: say no if asked to.]`;
}
