/** Role identity on the existing worker tag. Repaint only when the displayed identity changes. */
import * as THREE from 'three';
import { disposeSprite, textSprite } from '../toon';

export type WorkerNameplateRole = { kind: 'ceo' } | { kind: 'manager'; department: string };
const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function nameplateText(name: string, role?: WorkerNameplateRole): { name: string; title?: string; crown: boolean } {
  if (!role) return { name, crown: false };
  const title = role.kind === 'ceo' ? 'CEO' : `${role.department.trim() || 'Department'} Manager`;
  // Default role names sometimes already ARE the title, including "MarketingManager".
  return normalized(name) === normalized(title)
    ? { name: title, crown: role.kind === 'ceo' }
    : { name, title, crown: role.kind === 'ceo' };
}

export function nameplateRoleForWorker(id: string, ceo: { workerId?: string } | undefined, departments: readonly { name: string; lead?: { workerId?: string } }[]): WorkerNameplateRole | undefined {
  if (ceo?.workerId === id) return { kind: 'ceo' };
  const department = departments.find(d => d.lead?.workerId === id);
  return department ? { kind: 'manager', department: department.name } : undefined;
}

/** Keep the same sprite/texture across state broadcasts and animation frames. */
export function updateWorkerNameplate(root: THREE.Group, previous: THREE.Sprite | null, name: string, role?: WorkerNameplateRole): THREE.Sprite {
  const text = nameplateText(name, role);
  const key = JSON.stringify([text, !!role]);
  if (previous?.userData.nameplateKey === key) return previous;
  const sprite = role ? roleSprite(text) : textSprite(name, { bg: '#2b2d42', color: '#fffaf3', size: 36, border: '#fffaf3' });
  sprite.userData.nameplateKey = key;
  sprite.userData.nameplate = { ...text, role: role?.kind ?? 'worker' };
  sprite.position.y = previous?.position.y ?? 1.55;
  if (previous) { root.remove(previous); disposeSprite(previous); }
  root.add(sprite);
  return sprite;
}

function roleSprite(text: ReturnType<typeof nameplateText>): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = (size: number) => `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
  const fit = (value: string, max: number) => {
    if (ctx.measureText(value).width <= max) return value;
    const chars = [...value];
    while (chars.length && ctx.measureText(`${chars.join('')}…`).width > max) chars.pop();
    return `${chars.join('')}…`;
  };
  ctx.font = font(36);
  const name = fit(text.name, 410);
  const nameWidth = ctx.measureText(name).width;
  ctx.font = font(23);
  // Put the role first for very long department names so "Manager" is never clipped away.
  const title = text.title?.endsWith(' Manager') ? `Manager · ${text.title.slice(0, -8)}` : text.title;
  const roleLine = title ? fit(title, 410) : undefined;
  const width = Math.ceil(Math.max(nameWidth, roleLine ? ctx.measureText(roleLine).width : 0)) + 48 + (text.crown ? 22 : 0);
  const height = roleLine ? 94 : 64;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#f5cf70'; ctx.strokeStyle = '#73501c'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(3, 3, width - 6, height - 6, 18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#302517'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (roleLine) { ctx.font = font(23); ctx.fillText(roleLine, width / 2 + (text.crown ? 10 : 0), 26); }
  ctx.font = font(36); ctx.fillText(name, width / 2 + (!roleLine && text.crown ? 10 : 0), roleLine ? 65 : 33);
  if (text.crown) {
    ctx.font = font(roleLine ? 23 : 36);
    const lineWidth = roleLine ? ctx.measureText(roleLine).width : nameWidth;
    const x = (width - lineWidth) / 2 - 18, y = roleLine ? 19 : 25;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 5); ctx.lineTo(x + 10, y - 3); ctx.lineTo(x + 15, y + 5); ctx.lineTo(x + 20, y); ctx.lineTo(x + 17, y + 13); ctx.lineTo(x + 3, y + 13); ctx.closePath(); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }));
  sprite.scale.set(width * 0.0055, height * 0.0055, 1); sprite.renderOrder = 10;
  return sprite;
}
