/** Camera-relative axes, with a small dead zone and a circular speed limit. */
export function stickMovement(dx: number, dy: number, radius: number) {
  const distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance <= radius * 0.08) return { x: 0, z: 0 };
  const speed = Math.min(1, (distance / radius - 0.08) / 0.92);
  return { x: dx / distance * speed, z: dy / distance * speed };
}

/** Same pitch limits/signs as mouse-look; sensitivity scales with the shorter viewport side. */
export function lookDrag(yaw: number, pitch: number, dx: number, dy: number, shortSide: number, third = false) {
  const sensitivity = 1.8 / Math.max(320, Math.min(800, shortSide));
  return {
    yaw: yaw - dx * sensitivity,
    pitch: Math.max(third ? 0.05 : -1.45, Math.min(third ? 1.3 : 1.45, pitch + dy * sensitivity * (third ? 1 : -1))),
  };
}

export interface Insets { top: number; right: number; bottom: number; left: number }
export function touchLayout(width: number, height: number, safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const short = Math.min(width, height);
  const stick = Math.round(Math.max(96, Math.min(144, short * 0.3)));
  const action = Math.round(Math.max(72, Math.min(96, short * 0.22)));
  const row = Math.max(stick, action + 52);
  return { short, stick, action, row, left: safe.left + 12, right: safe.right + 12, bottom: safe.bottom + 12 };
}

export interface Rect { left: number; right: number; top: number; bottom: number }
/** Largest usable right-side rectangle, leaving the actual HUD hit areas clear (also in landscape). */
export function lookRegion(width: number, top: number, bottom: number, right: number, obstacles: Rect[]) {
  let best = { left: width * 0.48, top, width: 0, height: 0 };
  for (const left of [width * 0.48, ...obstacles.map(r => r.right + 12)]) {
    if (left < width * 0.48 || right - left < 72) continue;
    const edge = Math.min(bottom, ...obstacles.filter(r => r.right > left && r.left < right && r.bottom > top).map(r => r.top - 12));
    const height = Math.max(0, edge - top);
    if ((right - left) * height > best.width * best.height) best = { left, top, width: right - left, height };
  }
  return best;
}
