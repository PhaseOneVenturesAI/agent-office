// What the TV shows when it isn't showing a picture: its idle card, and what a video's up to.
import * as THREE from 'three';

/** A 1280×720 card: a gradient, a big line and a smaller one. */
export function tvCard(title: string, sub: string, from = '#3a0ca3', to = '#4cc9f0'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1280, 720);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '900 88px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(title, 640, 330, 1180);
  g.font = '700 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText(sub, 640, 420, 1180);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
