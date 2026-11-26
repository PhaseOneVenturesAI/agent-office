import * as THREE from 'three';
import { disposeSprite } from '../../../world/toon';

/** One bounded, two-line plate. Redrawing preserves focus layers and preview visibility. */
export class PersonalNameplate {
  readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
  private key = '';

  constructor(y: number) {
    this.sprite.name = 'personal-nameplate';
    this.sprite.position.y = y;
    this.sprite.renderOrder = 10;
  }

  set(title: string, status: string, color: string) {
    const key = JSON.stringify([title, status, color]);
    if (key === this.key) return;
    this.key = key;
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d')!;
    const font = (size: number, weight = 800) => `${weight} ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
    c.font = font(36);
    const titleWidth = c.measureText(title).width;
    c.font = font(27, 600);
    canvas.width = Math.min(640, Math.ceil(Math.max(titleWidth, c.measureText(status).width)) + 48);
    canvas.height = 100;
    c.fillStyle = '#f4ecdf'; c.strokeStyle = '#2b2d42'; c.lineWidth = 3;
    c.beginPath(); c.roundRect(2, 2, canvas.width - 4, 96, 14); c.fill(); c.stroke();
    c.fillStyle = color; c.beginPath(); c.roundRect(8, 12, 10, 76, 5); c.fill();
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#2b2d42';
    const line = (text: string, y: number) => {
      let fitted = text;
      while (fitted.length > 1 && c.measureText(fitted).width > canvas.width - 48) fitted = fitted.slice(0, -2) + '…';
      c.fillText(fitted, 28, y);
    };
    c.font = font(36); line(title, 32);
    c.font = font(27, 600); line(status, 73);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    this.sprite.material.map?.dispose();
    this.sprite.material.map = map; this.sprite.material.needsUpdate = true;
    this.sprite.scale.set(canvas.width * 0.003, 0.3, 1);
    this.sprite.userData.lines = [title, status];
  }

  dispose() { this.sprite.removeFromParent(); disposeSprite(this.sprite); }
}
