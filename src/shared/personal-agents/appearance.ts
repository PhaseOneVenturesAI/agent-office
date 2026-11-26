/** One account colour, restricted to colours legible against the office's cream and wood. */
export const OWNER_PALETTE = [
  { name: 'Violet', color: '#6c4fd8' }, { name: 'Teal', color: '#1f8a7a' },
  { name: 'Red', color: '#d1495b' }, { name: 'Orange', color: '#e07a3f' },
  { name: 'Blue', color: '#1e40c8' }, { name: 'Green', color: '#3f8f4f' },
  { name: 'Pink', color: '#c94f8a' }, { name: 'Slate', color: '#4a5568' },
] as const;
export type OwnerColor = typeof OWNER_PALETTE[number]['color'];
export function isOwnerColor(value: unknown): value is OwnerColor {
  return OWNER_PALETTE.some(p => p.color === value);
}
export function defaultOwnerColor(accountId: string): OwnerColor {
  let hash = 2166136261;
  for (const c of accountId) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return OWNER_PALETTE[hash % OWNER_PALETTE.length].color;
}
export type PersonalRole = 'CEO' | 'Marketing' | 'Design' | 'Product' | 'Agent';
export interface RoleSource { department?: string; harnessRole?: string; leadTitle?: string; designer?: boolean }
export function personalRole(source: RoleSource = {}, mainLead = false): PersonalRole {
  const text = source.department || source.leadTitle || source.harnessRole || (source.designer ? 'designer' : '');
  if (/\b(marketing|marketer|growth)\b/i.test(text)) return 'Marketing';
  if (/\b(design|designer)\b/i.test(text)) return 'Design';
  if (/\b(product)\b/i.test(text)) return 'Product';
  if (/\b(ceo|main lead|project lead)\b/i.test(text)) return 'CEO';
  return mainLead && !source.department && !source.leadTitle ? 'CEO' : 'Agent';
}
export function personalName(owner: string, project: string, role: PersonalRole): string {
  return `${owner.trim().split(/\s+/)[0] || 'Owner'}'s · ${project.trim() || 'Project'} ${role}`;
}
export function helperName(tool: string, task: string): string {
  const name = /codex/i.test(tool) ? 'Codex' : /kimi/i.test(tool) ? 'Kimi' : tool;
  return `${name} · ${task.trim() || 'Idle'}`;
}
export const helperTool = (tool: string) => /^(codex|kimi)\b/i.test(tool);
export function outfitFor(role: PersonalRole, color: OwnerColor) {
  return { top: role === 'CEO' ? '#303449' : role === 'Design' ? '#fff3da' : role === 'Product' ? '#4577aa' : color,
    accent: color, prop: role === 'Marketing' ? 'megaphone' : role === 'Product' ? 'clipboard' : null } as const;
}
