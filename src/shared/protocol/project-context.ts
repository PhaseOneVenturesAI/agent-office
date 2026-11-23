/** Project files, not provider-home memory or proof of an agent's loaded context. */
export interface ContextSource { path: string; present: boolean; size?: number; unavailable?: boolean }
export interface ContextScope {
  floor: string; project: string; host: string; source: 'project checkout'; loaded: 'unknown';
}
export interface ContextIndex { scope: ContextScope; sources: ContextSource[]; more: boolean; canEdit: boolean }
export interface ContextFile {
  path: string; text: string | null; revision: string; status: 'present' | 'missing' | 'unavailable';
}
export type ContextAction = 'edit' | 'archive' | 'supersede' | 'restore';
export interface ContextRevision {
  id: string; path: string; action: ContextAction; by: string; at: number; reason: string;
  before: string; after: string; hasText: boolean; outcome: 'applied' | 'failed' | 'unconfirmed';
  supersededBy?: string; restoredFrom?: string;
}
export interface ContextHistory { revisions: ContextRevision[]; next?: string }
export interface ContextMutation {
  path: string; base: string; action: ContextAction; reason: string;
  text?: string; replacement?: string; revision?: string;
}
