import * as THREE from 'three';
import { disposeSprite, textSprite } from '../toon';

/** Existing name pill, with a smaller account label; rebuilt only when its text changes. */
export class WorkerNameplate extends THREE.Group {
  private nameText = '';
  private ownerText = '';
  private nameSprite?: THREE.Sprite;
  private ownerSprite?: THREE.Sprite;

  setName(name: string) {
    if (name === this.nameText && this.nameSprite) return;
    this.nameText = name;
    if (this.nameSprite) { this.remove(this.nameSprite); disposeSprite(this.nameSprite); }
    this.nameSprite = textSprite(name, { bg: '#2b2d42', color: '#fffaf3', size: 36, border: '#fffaf3' });
    this.nameSprite.position.y = 0.16; // Leave room for the owner line above the antenna.
    this.add(this.nameSprite);
  }

  setOwner(name?: string) {
    const text = `Owner: ${name?.trim() || 'Unknown'}`;
    if (text === this.ownerText) return;
    this.ownerText = text;
    if (this.ownerSprite) { this.remove(this.ownerSprite); disposeSprite(this.ownerSprite); }
    this.ownerSprite = textSprite(text, { bg: '#2b2d42', color: '#d6cbbd', size: 18, border: '#2b2d42' });
    this.ownerSprite.position.y = -0.09;
    this.add(this.ownerSprite);
  }

  dispose() {
    if (this.nameSprite) disposeSprite(this.nameSprite);
    if (this.ownerSprite) disposeSprite(this.ownerSprite);
    this.clear();
  }
}
