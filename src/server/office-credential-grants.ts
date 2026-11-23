import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SignInKind } from '../shared/protocol.js';

/** Host-owner managed, never writable through the account/admin APIs. Missing/malformed denies. */
export function officeCredentialGrant(dataDir: string, accountId: string, which: SignInKind): boolean {
  try {
    const grants: unknown = JSON.parse(readFileSync(path.join(dataDir, 'office-credential-grants.json'), 'utf8'));
    if (!grants || typeof grants !== 'object' || Array.isArray(grants) || !Object.hasOwn(grants, accountId)) return false;
    const allowed = (grants as Record<string, unknown>)[accountId];
    return Array.isArray(allowed) && allowed.includes(which);
  } catch { return false; }
}
