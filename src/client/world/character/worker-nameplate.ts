import * as THREE from 'three';
import { disposeSprite } from '../toon';

/** One cached name pill: the agent is primary, its verified account is secondary. */
export class WorkerNameplate extends THREE.Group {
  private nameText = '';
  private ownerText = 'Owner: Unknown';
  private sprite?: THREE.Sprite;

  setName(name: string) {
    if (name === this.nameText && this.sprite) return;
    this.nameText = name;
    this.redraw();
  }

  setOwner(name?: string) {
    const text = `Owner: ${name?.trim() || 'Unknown'}`;
    if (text === this.ownerText) return;
    this.ownerText = text;
    this.redraw();
  }

  private redraw() {
    if (this.sprite) { this.remove(this.sprite); disposeSprite(this.sprite); }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = (size: number) => `800 ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
    ctx.font = font(36); const nameWidth = ctx.measureText(this.nameText).width;
    ctx.font = font(18); const ownerWidth = ctx.measureText(this.ownerText).width;
    canvas.width = Math.ceil(Math.max(nameWidth, ownerWidth)) + 36;
    canvas.height = 82;
    ctx.fillStyle = '#2b2d42'; ctx.strokeStyle = '#fffaf3'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(3, 3, canvas.width - 6, 76, 24); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(36); ctx.fillStyle = '#fffaf3'; ctx.fillText(this.nameText, canvas.width / 2, 29);
    ctx.font = font(18); ctx.fillStyle = '#d6cbbd'; ctx.fillText(this.ownerText, canvas.width / 2, 62);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, transparent: true }));
    this.sprite.scale.set(canvas.width * 0.0055, canvas.height * 0.0055, 1);
    this.sprite.position.y = 0.06; // Keep the shared pill clear of the antenna.
    this.sprite.renderOrder = 10;
    this.add(this.sprite);
  }

  dispose() {
    if (this.sprite) disposeSprite(this.sprite);
    this.clear();
  }
}
