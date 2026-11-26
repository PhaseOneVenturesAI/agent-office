/** One account colour, restricted to colours legible against the office's cream and wood. */
export const OWNER_PALETTE = [
  { name: 'Violet', color: '#5b3cc4' }, { name: 'Teal', color: '#0f7a6b' },
  { name: 'Red', color: '#c0283f' }, { name: 'Orange', color: '#c2560f' },
  { name: 'Blue', color: '#1e40c8' }, { name: 'Green', color: '#2e7d3a' },
  { name: 'Pink', color: '#b8327a' }, { name: 'Slate', color: '#414c60' },
] as const;
export type OwnerColor = typeof OWNER_PALETTE[number]['color'];
export function isOwnerColor(value: unknown): value is OwnerColor {
  return OWNER_PALETTE.some(p => p.color === value);
}
/** Preserve the selected swatch when loading records written before the contrast adjustment. */
export function savedOwnerColor(value: unknown): OwnerColor | undefined {
  if (isOwnerColor(value)) return value;
  const previous = ['#6c4fd8', '#1f8a7a', '#d1495b', '#e07a3f', '#1e40c8', '#3f8f4f', '#c94f8a', '#4a5568'];
  const index = previous.indexOf(String(value));
  return index < 0 ? undefined : OWNER_PALETTE[index].color;
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
  return { top: color,
    accent: color, prop: role === 'Marketing' ? 'megaphone' : role === 'Product' ? 'clipboard' : null } as const;
}
